import { fill, slugify } from '../config/config.js'
import { createPrompt } from '../core/llm.js'
import { log } from '../core/log.js'
import { everyN, makeTurnLabels, toContext } from './context.js'
import { mergePresetRoles, presetError, presetSynth, resolve, validatePreset } from './helpers.js'
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
      synthSelector = preset ? presetSynth(preset, args.models, models, effectiveRoles) : args.synthesize,
      synthInterval = synthSelector === undefined ? Infinity : everyN(preset?.synthesizeEvery ?? args.synthesizeEvery),
      closing = (preset?.closingStatements ?? args.closingStatements) === true

   // Closing statements are a final speaker pass right before synthesis, so they only make sense with a synthesizer.
   if (closing && synthSelector === undefined)
      return err(errors.closingWithoutSynth)

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, args.models, presets, models, roles), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   // One Speaker per selector, keeping order AND duplicates — position is the stable identity.
   const
      seats = args.models.map((selector, index) => ({ selector, index, r: resolve(selector, models, effectiveRoles) })),
      bad = seats.find(s => s.r === null)
   if (bad)
      return err(fill(errors.unknownSelector, { selector: bad.selector }))

   const
      speakers: Speaker[] = seats.map(({ selector, index, r }) => ({ index, selector, def: r!.def, role: r!.role })),
      // The synthesizer never speaks in normal rounds. If its selector is in models[], the FIRST match synthesizes and later duplicates stay round speakers; an external synth appends one seat past the list.
      synthIndex = synthSelector === undefined ? -1 : speakers.findIndex(s => s.selector === synthSelector),
      external = synthSelector !== undefined && synthIndex === -1 ? resolve(synthSelector, models, effectiveRoles) : null,
      synth: Speaker | undefined = synthSelector === undefined
         ? undefined
         : synthIndex !== -1
            ? speakers[synthIndex]
            : external
               ? { index: speakers.length, selector: synthSelector, def: external.def, role: external.role }
               : undefined,
      roundSpeakers = synth === undefined ? speakers : speakers.filter(s => s.index !== synth.index),
      labels = makeTurnLabels(synth && synth.index === speakers.length ? [...speakers, synth] : speakers),
      { telemetry, turns, content, used, speakOne, record, skip } = makeTurnRunner(args, effectiveRoles, roundSpeakers, rounds, prompt, templates),
      full = () => toContext(turns, labels, templates, args.context),
      // Per-speaker context for a round turn, honoring the mode's visibility policy.
      seen = (speaker: Speaker, snapshot: QuorumTurn[]): string | undefined =>
         mode === 'independent'
            ? args.context
            : mode === 'private'
               ? toContext(snapshot.filter(t => t.index === speaker.index), labels, templates, args.context)
               : toContext(snapshot, labels, templates, args.context),
      // Buffer a whole phase, then record in council order so content[] reads in seat order, not completion order.
      runParallel = async (round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined): Promise<void> => {
         for (const outcome of await Promise.all(roundSpeakers.map(s => speakOne(s, round, phase, ctx(s)))))
            record(outcome, round)
      },
      runSynthesis = async (round: number): Promise<void> => {
         if (synthSelector === undefined) return
         if (synth === undefined) {
            telemetry.push({ index: -1, selector: synthSelector, modelName: '', modelId: '', round, phase: 'synthesis', usage: {}, latencyMs: 0, status: errors.unresolvableSelector })
            return
         }
         record(await speakOne(synth, round, 'synthesis', full()), round)
         telemetry[telemetry.length - 1]?.status.includes('reasoning-heavy') &&
            log('warn', `⚠️ synthesis (${synthSelector}) spent most of its budget reasoning — raise maxTokens or use a lighter model for synthesize`)
      }

   for (let round = 1; round <= rounds; round++) {
      if (tokenBudget && used() >= tokenBudget) {
         for (let r = round; r <= rounds; r++) skip(r)
         log('warn', `⚠️ token budget ${tokenBudget} exceeded (${used()}) — skipping remaining turns`)
         break
      }
      if (mode === 'sequential')
         for (let i = 0; i < roundSpeakers.length; i++) {
            if (tokenBudget && used() >= tokenBudget) { skip(round, i); break }
            record(await speakOne(roundSpeakers[i]!, round, 'round', seen(roundSpeakers[i]!, turns)), round)
         }
      else {
         const snapshot = [...turns]
         await runParallel(round, 'round', s => seen(s, snapshot))
      }
      // Per-round synthesis on the interval — but when closing is on, skip the final round's so there's one synthesis, after closing.
      if (synthInterval !== Infinity && (round % synthInterval === 0 || round === rounds) && !(closing && round === rounds))
         await runSynthesis(round)
   }

   // Closing statements: one final parallel pass over the whole transcript, right before the final synthesis.
   if (closing && !(tokenBudget && used() >= tokenBudget))
      await runParallel(rounds + 1, 'closing', full)
   else if (closing)
      skip(rounds + 1, 0, 'closing')

   // End-only synthesis, or the single synthesis that follows closing statements, runs once after all rounds (round 0).
   if (synthInterval === Infinity || closing)
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
