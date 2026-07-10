import { fill, slugify } from '../config/config.js'
import { createPrompt } from '../core/llm.js'
import { log } from '../core/log.js'
import { everyN, makeTurnLabels, toContext } from './context.js'
import { dedup, mergePresetRoles, presetError, presetSynth, resolve, validatePreset } from './helpers.js'
import { makeTurnRunner } from './runner.js'

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
      synthesize = preset ? presetSynth(preset, selectors, models, effectiveRoles) : args.synthesize,
      synthInterval = synthesize === undefined ? Infinity : everyN(preset?.synthesizeEvery ?? args.synthesizeEvery)

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, selectors, presets, models, roles), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   const
      resolved = selectors.map(s => resolve(s, models, effectiveRoles)),
      badIndex = resolved.indexOf(null)
   if (badIndex !== -1)
      return err(fill(errors.unknownSelector, { selector: selectors[badIndex]! }))

   // The synthesizer never speaks in normal rounds — it only runs in its synthesis slot(s).
   const
      roundSelectors = synthesize === undefined ? selectors : selectors.filter(s => s !== synthesize),
      roundResolved = synthesize === undefined ? resolved : roundSelectors.map(s => resolve(s, models, effectiveRoles)),
      labels = makeTurnLabels(selectors, models, effectiveRoles),
      { telemetry, turns, content, used, speakOne, record, skip } = makeTurnRunner(args, models, effectiveRoles, roundResolved, roundSelectors, rounds, prompt, templates),
      full = () => toContext(turns, labels, templates, args.context),
      // Per-speaker context for a round turn, honoring the mode's visibility policy.
      seen = (selector: string, snapshot: QuorumTurn[]): string | undefined =>
         mode === 'independent'
            ? args.context
            : mode === 'private'
               ? toContext(snapshot.filter(t => t.selector === selector), labels, templates, args.context)
               : toContext(snapshot, labels, templates, args.context),
      runSynthesis = async (round: number): Promise<void> => {
         if (synthesize === undefined) return
         if (!resolve(synthesize, models, effectiveRoles)) {
            telemetry.push({ selector: synthesize, modelName: '', modelId: '', round, isSynthesis: true, usage: {}, latencyMs: 0, status: errors.unresolvableSelector })
            return
         }
         record(await speakOne(synthesize, round, true, full()), round)
         telemetry[telemetry.length - 1]?.status.includes('reasoning-heavy') &&
            log('warn', `⚠️ synthesis (${synthesize}) spent most of its budget reasoning — raise maxTokens or use a lighter model for synthesize`)
      }

   for (let round = 1; round <= rounds; round++) {
      if (tokenBudget && used() >= tokenBudget) {
         for (let r = round; r <= rounds; r++) skip(r)
         log('warn', `⚠️ token budget ${tokenBudget} exceeded (${used()}) — skipping remaining turns`)
         break
      }
      if (mode === 'sequential')
         for (let i = 0; i < roundSelectors.length; i++) {
            if (tokenBudget && used() >= tokenBudget) { skip(round, i); break }
            record(await speakOne(roundSelectors[i]!, round, false, seen(roundSelectors[i]!, turns)), round)
         }
      else {
         // Buffer the whole round, then record in selector order so content[] reads in council order, not completion order.
         const snapshot = [...turns]
         for (const outcome of await Promise.all(roundSelectors.map(s => speakOne(s, round, false, seen(s, snapshot)))))
            record(outcome, round)
      }
      // Per-round synthesis: on the interval, and always on the final round so a run never ends unconsolidated.
      if ((round % synthInterval === 0 || round === rounds) && synthInterval !== Infinity)
         await runSynthesis(round)
   }

   // End-mode synthesis runs once after all rounds (round 0). Per-round mode already synthesized the final round.
   if (synthInterval === Infinity)
      await runSynthesis(0)

   return {
      content,
      structuredContent: {
         turns: telemetry,
         transcript: toContext(turns, labels, templates) ?? '',
         ...(args.preset ? { preset: args.preset } : {}),
         ...(tokenBudget ? { budget: { limit: tokenBudget, used: used(), exceeded: used() > tokenBudget } } : {})
      },
      isError: content.length === 0
   }
}
