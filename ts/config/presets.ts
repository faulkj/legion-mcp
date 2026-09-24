import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/v4'
import { slugify } from './config.js'
import { log } from '../core/log.js'
import { bundledFiles, layeredFiles, slugKey } from './text.js'

/**
 * Scan config/presets/*.json across both layers (local wins); each becomes a preset keyed by its
 * slugified file name. `PRESETS` is an allowlist over the BUNDLED set, so shipping a new bundled
 * preset never silently grows a curated deployment; unset exposes them all. A preset the deployment
 * authored itself is already a statement of intent, so local-only files are always exposed. A local
 * file that shadows a bundled slug is a customization of that preset, not a new one, and stays
 * subject to the allowlist.
 *
 * Presets reload per request, so a malformed file must not take the server down with it: the bad
 * preset is logged and skipped, and every other tool still registers. Throwing here would surface
 * as an unexplained `-32603` on `tools/list` — the validation message never reaching the author.
 */
export const loadPresets = (config: AppConfig): Presets => {
   const
      allowed = config.presets && new Set(config.presets),
      bundled = new Set(bundledFiles('presets', '.json', slugKey('.json'), f => f.endsWith('.example.json')).map(e => e.key))
   return Object.fromEntries(
      layeredFiles('presets', '.json', slugKey('.json'), f => f.endsWith('.example.json'))
         .filter(({ key }) => !allowed || allowed.has(key) || !bundled.has(key))
         .flatMap(({ key, dir, file }) => {
            try { return [[key, parsePresetFile(dir, file)] as const] }
            catch (e) {
               log('error', `❌ preset skipped — ${e instanceof Error ? e.message : String(e)}`)
               return []
            }
         })
   )
}

const
   presetSchema = z.object({
      description: z.union([z.string(), z.array(z.string())]),
      roles: z.array(z.object({
         role: z.string().min(1),
         description: z.union([z.string(), z.array(z.string())]).optional(),
         min: z.number().int().min(0).optional(),
         max: z.number().int().min(1).nullable().optional(),
         silent: z.boolean().optional(),
         voter: z.boolean().optional(),
         candidate: z.boolean().optional(),
         closing: z.boolean().optional(),
         closingLast: z.boolean().optional(),
         tagTeam: z.boolean().optional(),
         cameo: z.boolean().optional()
      })).min(1),
      mode: z.enum(['sequential', 'parallel', 'private', 'independent']).optional(),
      synthesizer: z.string().optional(),
      synthesizeEvery: z.union([z.literal('end'), z.number().int().min(0)]).optional(),
      framer: z.string().optional(),
      reframeEvery: z.union([z.literal('end'), z.number().int().min(0)]).optional(),
      closingStatements: z.boolean().optional(),
      eliminateEvery: z.number().int().min(0).optional(),
      eliminationsOptional: z.boolean().optional(),
      enterEvery: z.number().int().min(0).optional(),
      vote: z.string().optional(),
      voteEvery: z.union([z.literal('end'), z.number().int().min(0)]).optional(),
      voteVisibility: z.enum(['aggregate', 'ballots']).optional(),
      allowSelfVote: z.boolean().optional(),
      voteByTeam: z.boolean().optional(),
      defaultRounds: z.number().int().min(1).optional()
   }),

   effMin = (r: { min?: number }) => r.min ?? 1,

   effMax = (r: { max?: number | null }) => r.max === null ? Infinity : (r.max ?? 1),

   parsePresetFile = (dir: string, file: string): Preset => {
      let json: unknown
      try { json = JSON.parse(readFileSync(join(dir, file), 'utf8')) }
      catch { throw new Error(`${file} is not valid JSON.`) }

      const result = presetSchema.safeParse(json)
      if (!result.success)
         throw new Error(`Invalid ${file}:\n${z.prettifyError(result.error)}`)

      const
         { description, roles, mode, synthesizer, synthesizeEvery, framer, reframeEvery, closingStatements, eliminateEvery, eliminationsOptional, enterEvery, vote, voteEvery, voteVisibility, allowSelfVote, voteByTeam, defaultRounds } = result.data,
         bad = roles.find(r => effMin(r) > effMax(r)),
         badCloser = roles.find(r => r.closingLast && !r.closing)
      if (bad) throw new Error(`Invalid ${file}: role "${bad.role}" has min > max.`)
      if (badCloser) throw new Error(`Invalid ${file}: role "${badCloser.role}" sets closingLast without closing.`)
      if (enterEvery !== undefined && enterEvery > 0 && roles.some(r => r.tagTeam))
         throw new Error(`Invalid ${file}: enterEvery and tagTeam cannot be combined.`)
      if (roles.reduce((n, r) => n + effMin(r), 0) < 1)
         throw new Error(`Invalid ${file}: every role is optional (min 0) — a preset needs at least one speaker.`)
      if (synthesizeEvery !== undefined && synthesizer === undefined)
         throw new Error(`Invalid ${file}: "synthesizeEvery" only applies when "synthesizer" is set.`)
      if (closingStatements === true && synthesizer === undefined)
         throw new Error(`Invalid ${file}: "closingStatements" requires a "synthesizer" — they run right before the final synthesis.`)
      if (eliminateEvery !== undefined && eliminateEvery > 0 && synthesizer === undefined)
         throw new Error(`Invalid ${file}: "eliminateEvery" requires a "synthesizer" — the synthesizer decides who leaves.`)
      if (reframeEvery !== undefined && framer === undefined)
         throw new Error(`Invalid ${file}: "reframeEvery" only applies when "framer" is set.`)
      if ((voteEvery !== undefined || voteVisibility !== undefined || allowSelfVote !== undefined || voteByTeam !== undefined) && vote === undefined)
         throw new Error(`Invalid ${file}: vote options only apply when "vote" is set.`)
      if (framer !== undefined && !roles.find(r => slugify(r.role) === slugify(framer)))
         throw new Error(`Invalid ${file}: framer role "${framer}" must be a preset role.`)
      if (synthesizer !== undefined) {
         const synth = roles.find(r => slugify(r.role) === slugify(synthesizer))
         if (!synth)
            throw new Error(`Invalid ${file}: synthesizer role "${synthesizer}" must be a preset role.`)
         if (roles.some(r => slugify(r.role) !== slugify(synthesizer) && effMin(r) >= 1) === false)
            throw new Error(`Invalid ${file}: a preset with a synthesizer needs at least one other required role — the synthesizer no longer speaks in normal rounds.`)
      }
      return { description: Array.isArray(description) ? description.join('\n') : description, roles, mode, synthesize: synthesizer, synthesizeEvery, frame: framer, reframeEvery, closingStatements, eliminateEvery, eliminationsOptional, enterEvery, vote, voteEvery, voteVisibility, allowSelfVote, voteByTeam, defaultRounds }
   }
