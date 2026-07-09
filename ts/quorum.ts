import { fill, slugify } from './config.js'
import { createPrompt } from './llm.js'
import { log } from './log.js'
import { dedup, mergePresetRoles, presetError, presetSynth, resolve, toContext, validatePreset } from './quorumHelpers.js'
import { makeTurnRunner } from './turnRunner.js'

type Prompt = ReturnType<typeof createPrompt>

export const runQuorum = async (
   args: QuorumInput,
   models: ModelDef[],
   roles: RoleDef[],
   prompt: Prompt,
   maxRounds: number,
   dynamicRoles: boolean,
   templates: PromptTemplates,
   errors: ErrorMessages,
   tokenBudget?: number,
   presets: Presets = {}
): Promise<{ content: { type: 'text'; text: string }[]; structuredContent?: unknown; isError: boolean }> => {
   const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

   if (args.roles && Object.keys(args.roles).length && !dynamicRoles)
      return err(errors.adhocDisabled)

   const adHoc = Object.entries(args.roles ?? {}).map(([name, instructions]) => ({ name: slugify(name), instructions }))
   if (adHoc.some(r => !r.name))
      return err(errors.adhocEmptyName)

   const
      preset = args.preset === undefined ? undefined : presets[args.preset],
      baseRoles = [...roles.filter(r => !adHoc.some(a => a.name === r.name)), ...adHoc],
      effectiveRoles = preset ? mergePresetRoles(baseRoles, preset) : baseRoles,
      rounds = Math.min(maxRounds, Math.max(1, args.rounds ?? 1)),
      mode = preset?.mode ?? args.mode ?? 'sequential',
      selectors = dedup(args.models),
      synthesize = preset ? presetSynth(preset, selectors, models, effectiveRoles) : args.synthesize

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, selectors, presets, models, roles, effectiveRoles, adHoc), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   const
      resolved = selectors.map(s => resolve(s, models, effectiveRoles)),
      badIndex = resolved.indexOf(null)
   if (badIndex !== -1)
      return err(fill(errors.unknownSelector, { selector: selectors[badIndex]! }))

   const
      { telemetry, turns, content, used, speakOne, record, skip } = makeTurnRunner(args, models, effectiveRoles, resolved, selectors, rounds, prompt, templates),
      ctx = () => toContext(turns, templates, args.context)

   for (let round = 1; round <= rounds; round++) {
      if (tokenBudget && used() >= tokenBudget) {
         for (let r = round; r <= rounds; r++) skip(r)
         log('warn', `⚠️ token budget ${tokenBudget} exceeded (${used()}) — skipping remaining turns`)
         break
      }
      if (mode === 'sequential')
         for (let i = 0; i < selectors.length; i++) {
            if (tokenBudget && used() >= tokenBudget) { skip(round, i); break }
            record(await speakOne(selectors[i]!, round, false, ctx()), round)
         }
      else {
         // Buffer the whole round, then record in selector order so content[] reads in council order, not completion order.
         const prevCtx = ctx()
         for (const outcome of await Promise.all(selectors.map(s => speakOne(s, round, false, prevCtx))))
            record(outcome, round)
      }
   }

   if (synthesize !== undefined && !resolve(synthesize, models, effectiveRoles))
      telemetry.push({ selector: synthesize, modelName: '', modelId: '', round: 0, isSynthesis: true, usage: {}, latencyMs: 0, status: errors.unresolvableSelector })
   else if (synthesize !== undefined) {
      record(await speakOne(synthesize, 0, true, ctx()), 0)
      telemetry[telemetry.length - 1]?.status.includes('reasoning-heavy') &&
         log('warn', `⚠️ synthesis (${synthesize}) spent most of its budget reasoning — raise maxTokens or use a lighter model for synthesize`)
   }

   return {
      content,
      structuredContent: {
         turns: telemetry,
         transcript: toContext(turns, templates) ?? '',
         ...(args.preset ? { preset: args.preset } : {}),
         ...(tokenBudget ? { budget: { limit: tokenBudget, used: used(), exceeded: used() > tokenBudget } } : {})
      },
      isError: content.length === 0
   }
}
