import { fill, slugify } from '../config/config.js'
import { createPrompt } from '../core/llm.js'
import { log } from '../core/log.js'
import { everyN, toContext } from './context.js'
import { eliminationDue, makeEliminator, makeSynthesizer } from './phases.js'
import { mergePresetRoles, presetError, presetSynth, resolveSpeakers, validatePreset } from './helpers.js'
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
      rounds = Math.min(maxRounds, Math.max(1, args.rounds ?? preset?.defaultRounds ?? 1)),
      mode = preset?.mode ?? args.mode ?? 'sequential',
      synthSelector = preset ? presetSynth(preset, args.models, models, effectiveRoles) : args.synthesize,
      synthInterval = synthSelector === undefined ? Infinity : everyN(preset?.synthesizeEvery ?? args.synthesizeEvery),
      closing = (preset?.closingStatements ?? args.closingStatements) === true,
      eliminateEvery = preset?.eliminateEvery,
      optional = preset?.eliminationsOptional === true

   // Closing statements are a final speaker pass right before synthesis, so they only make sense with a synthesizer.
   if (closing && synthSelector === undefined)
      return err(errors.closingWithoutSynth)

   // Eliminations are decided by the synthesizer, so they require one too.
   if (eliminateEvery !== undefined && eliminateEvery > 0 && synthSelector === undefined)
      return err(errors.eliminateWithoutSynth)

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, args.models, presets, models, roles), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   const { speakers, roundSpeakers, synth, labels, bad } = resolveSpeakers(args.models, synthSelector, models, effectiveRoles)
   if (bad) return err(fill(errors.unknownSelector, { selector: bad }))

   const
      { telemetry, turns, content, used, speakOne, record, note, skip } = makeTurnRunner(args, effectiveRoles, roundSpeakers, rounds, prompt, templates),
      // An eliminated speaker is removed for good — no longer prompted, so it costs nothing after its cut. `live` shrinks as the synthesizer removes them.
      live = new Set(roundSpeakers.map(s => s.index)),
      liveSpeakers = (): Speaker[] => roundSpeakers.filter(s => live.has(s.index)),
      full = () => toContext(turns, labels, templates, args.context),
      // Per-speaker context for a round turn, honoring the mode's visibility policy. The speaker's own prior turns are marked so it knows which were its own.
      seen = (speaker: Speaker, snapshot: QuorumTurn[]): string | undefined =>
         mode === 'independent'
            ? args.context
            : mode === 'private'
               ? toContext(snapshot.filter(t => t.index === speaker.index), labels, templates, args.context, speaker.index)
               : toContext(snapshot, labels, templates, args.context, speaker.index),
      // Buffer a whole phase, then record in council order so content[] reads in seat order, not completion order.
      runParallel = async (speakers: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined): Promise<void> => {
         for (const outcome of await Promise.all(speakers.map(s => speakOne(s, round, phase, ctx(s)))))
            record(outcome, round)
      },
      deps = { synth, synthSelector, labels, optional, templates, errors, live, liveSpeakers, full, telemetry, speakOne, record, note },
      runSynthesis = makeSynthesizer(deps),
      runElimination = makeEliminator(deps)

   for (let round = 1; round <= rounds; round++) {
      if (tokenBudget && used() >= tokenBudget) {
         for (let r = round; r <= rounds; r++) skip(r)
         log('warn', `⚠️ token budget ${tokenBudget} exceeded (${used()}) — skipping remaining turns`)
         break
      }
      const speaking = liveSpeakers()
      if (mode === 'sequential')
         for (let i = 0; i < speaking.length; i++) {
            if (tokenBudget && used() >= tokenBudget) { skip(round, i); break }
            record(await speakOne(speaking[i]!, round, 'round', seen(speaking[i]!, turns)), round)
         }
      else {
         const snapshot = [...turns]
         await runParallel(speaking, round, 'round', s => seen(s, snapshot))
      }
      // Per-round synthesis on the interval — but when closing is on, skip the final round's so there's one synthesis, after closing.
      if (synthInterval !== Infinity && (round % synthInterval === 0 || round === rounds) && !(closing && round === rounds))
         await runSynthesis(round)
      // Eliminations run on their own cadence after any synthesis, including the final round.
      if (eliminationDue(eliminateEvery, round))
         await runElimination(round)
   }

   // Closing statements: one final parallel pass over the whole transcript, right before the final synthesis.
   if (closing && !(tokenBudget && used() >= tokenBudget))
      await runParallel(liveSpeakers(), rounds + 1, 'closing', full)
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
