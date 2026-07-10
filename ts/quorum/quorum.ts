import { fill, slugify } from '../config/config.js'
import { log } from '../core/log.js'
import { everyN, makeSeen, toContext } from './context.js'
import { entrantFirst, entryDue, makeEntry, nextEntrant, objectiveError, recordEntry, withObjective } from './entry.js'
import { eliminationDue, frameDue, makeEliminator, makeFramer, makeSynthesizer } from './phases.js'
import { mergePresetRoles, presetError, presetFrame, presetSynth, resolveSpeakers, validatePreset } from './helpers.js'
import { makeTurnRunner } from './runner.js'

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
      frameSelector = preset ? presetFrame(preset, args.models, models, effectiveRoles) : args.frame,
      reframeEvery = preset?.reframeEvery ?? args.reframeEvery,
      closing = (preset?.closingStatements ?? args.closingStatements) === true,
      eliminateEvery = preset?.eliminateEvery,
      enterEvery = preset?.enterEvery,
      optional = preset?.eliminationsOptional === true

   // Closing statements and eliminations both hinge on the synthesizer, so require one for either.
   if (closing && synthSelector === undefined)
      return err(errors.closingWithoutSynth)
   if (eliminateEvery !== undefined && eliminateEvery > 0 && synthSelector === undefined)
      return err(errors.eliminateWithoutSynth)

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, args.models, presets, models, roles), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   const { speakers, roundSpeakers, synth, frame, labels, bad } = resolveSpeakers(args.models, synthSelector, models, effectiveRoles, frameSelector)
   if (bad) return err(fill(errors.unknownSelector, { selector: bad }))
   if (synth?.team !== undefined) return err(errors.synthTeamed)
   if (frame?.team !== undefined) return err(errors.frameTeamed)
   const setupErr = objectiveError(roundSpeakers, args.objectives)
   if (setupErr) return err(setupErr)

   const
      { telemetry, turns, content, used, speakOne, record, note, skip, runParallel } = makeTurnRunner(args, effectiveRoles, roundSpeakers, rounds, prompt, templates),
      // `live` shrinks on elimination, `entered` grows on entry; effective = entered AND live (one seam rounds + eliminator read).
      live = new Set(roundSpeakers.map(s => s.index)),
      entry = makeEntry(roundSpeakers, enterEvery),
      liveSpeakers = (): Speaker[] => roundSpeakers.filter(s => entry.entered.has(s.index) && live.has(s.index)),
      full = () => toContext(turns, labels, templates, args.context),
      seen = makeSeen(mode, labels, templates, args.context, args.objectives, withObjective),
      // The neutral synth sees every team's objective; wrap `full` so synthesis/elimination carry all objectives.
      refFull = () => withObjective(synth, args.objectives, true, full()),
      deps = { synth, synthSelector, frame, prompt: args.prompt, labels, optional, templates, errors, live, liveSpeakers, full: refFull, telemetry, speakOne, record, note },
      runSynthesis = makeSynthesizer(deps),
      runElimination = makeEliminator(deps),
      runFrame = makeFramer(deps)

   for (let round = 1; round <= rounds; round++) {
      if (tokenBudget && used() >= tokenBudget) {
         for (let r = round; r <= rounds; r++) skip(r, 0, 'round', liveSpeakers())
         log('warn', `⚠️ token budget ${tokenBudget} exceeded (${used()}) — skipping remaining turns`)
         break
      }
      // Framer opens/steers at the top of the round (before entry), so the field reacts to it.
      if (frameDue(reframeEvery, round)) await runFrame(round)
      // Staggered entry: a benched speaker joins on cadence and (sequential) speaks first this round.
      const
         entrant = entryDue(entry, enterEvery, round) ? nextEntrant(entry) : undefined,
         // The fresh entrant is nudged to bring something new instead of echoing the field.
         entrantPrompt = (s: Speaker): string | undefined => s.index === entrant?.index ? templates.entrant + args.prompt : undefined
      if (entrant) recordEntry(note, entrant, round, labels[entrant.index] ?? entrant.selector)
      const speaking = entrantFirst(liveSpeakers(), entrant)
      if (mode === 'sequential')
         for (let i = 0; i < speaking.length; i++) {
            if (tokenBudget && used() >= tokenBudget) { skip(round, i, 'round', speaking); break }
            record(await speakOne(speaking[i]!, round, 'round', seen(speaking[i]!, turns), entrantPrompt(speaking[i]!)), round)
         }
      else {
         const snapshot = [...turns]
         await runParallel(speaking, round, 'round', s => seen(s, snapshot), entrantPrompt)
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
