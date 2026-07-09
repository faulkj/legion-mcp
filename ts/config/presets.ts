import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as z from 'zod/v4'
import { slugify } from './config.js'

/** Scan config/presets/*.json; each `<name>.json` becomes a preset keyed by its slugified file name. Missing dir → none. */
export const loadPresets = (config: AppConfig): Presets => {
   let files: string[]
   try { files = readdirSync(config.presetsDir).filter(f => f.endsWith('.json') && !f.endsWith('.example.json')) }
   catch { return {} }
   const
      entries = files.map(f => [slugify(basename(f, '.json')), parsePresetFile(config.presetsDir, f)] as const),
      seen = new Set<string>()
   entries.forEach(([slug]) => seen.has(slug) ? (() => { throw new Error(`Preset slug collision: "${slug}". Rename one.`) })() : seen.add(slug))
   return Object.fromEntries(entries)
}

const
   presetSchema = z.object({
      description: z.union([z.string(), z.array(z.string())]),
      roles: z.array(z.object({
         role: z.string().min(1),
         description: z.string().optional(),
         min: z.number().int().min(0).optional(),
         max: z.number().int().min(1).nullable().optional()
      })).min(1),
      mode: z.enum(['sequential', 'parallel']).optional(),
      synthesizer: z.string().optional()
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
         { description, roles, mode, synthesizer } = result.data,
         bad = roles.find(r => effMin(r) > effMax(r))
      if (bad) throw new Error(`Invalid ${file}: role "${bad.role}" has min > max.`)
      if (roles.reduce((n, r) => n + effMin(r), 0) < 1)
         throw new Error(`Invalid ${file}: every role is optional (min 0) — a preset needs at least one speaker.`)
      if (synthesizer !== undefined) {
         const synth = roles.find(r => slugify(r.role) === slugify(synthesizer))
         if (!synth || effMin(synth) < 1)
            throw new Error(`Invalid ${file}: synthesizer role "${synthesizer}" must be a preset role with min >= 1.`)
      }
      return { description: Array.isArray(description) ? description.join('\n') : description, roles, mode, synthesize: synthesizer }
   }
