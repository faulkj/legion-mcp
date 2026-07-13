import { fill } from '../config/config.js'
import { log } from '../core/log.js'
import { makeSeen, toContext } from './context.js'
import { entrantFirst, entryDue, makeEntry, nextEntrant, objectiveError, recordEntry, withObjective } from './entry.js'
import { eliminationDue, frameDue, makeEliminator, makeFramer, makeSynthesizer } from './phases.js'
import { presetError, resolveSpeakers, validatePreset } from './helpers.js'
import { makeTurnRunner } from './runner.js'
import { resolveConfig } from './setup.js'
import { makeVoter } from './voting.js'

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

   const
      { preset, effectiveRoles, adHocEmpty, rounds, mode, synthSelector, synthInterval, frameSelector, reframeEvery, closing, eliminateEvery, enterEvery, optional, silentRoles, error } = resolveConfig(args, models, roles, presets, maxRounds)
   if (adHocEmpty) return err(errors.adhocEmptyName)
   if (error) return err(errors[error])

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, args.models, presets, models, roles), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   const { speakers, roundSpeakers, synth, frame, labels, bad } = resolveSpeakers(args.models, synthSelector, models, effectiveRoles, frameSelector, silentRoles)
   if (bad) return err(fill(errors.unknownSelector, { selector: bad }))
   if (synth?.team !== undefined) return err(errors.synthTeamed)
   if (frame?.team !== undefined) return err(errors.frameTeamed)
   const setupErr = objectiveError(roundSpeakers, args.objectives)
   if (setupErr) return err(setupErr)

   const
      { telemetry, turns, content, used, speakOne, record, note, skip, runParallel, runHidden } = makeTurnRunner(args, effectiveRoles, roundSpeakers, rounds, prompt, templates),
      // `live` shrinks on elimination, `entered` grows on entry; effective = entered AND live (one seam rounds + eliminator read).
      live = new Set(roundSpeakers.map(s => s.index)),
      entry = makeEntry(roundSpeakers, enterEvery),
      // voters = every effective seat (incl. a silent electorate); liveSpeakers (rounds/elimination) drops silent.
      voters = (): Speaker[] => roundSpeakers.filter(s => entry.entered.has(s.index) && live.has(s.index)),
      liveSpeakers = (): Speaker[] => voters().filter(s => !s.silent),
      full = () => toContext(turns, labels, templates, args.context),
      seen = makeSeen(mode, labels, templates, args.context, args.objectives, withObjective),
      refFull = () => withObjective(synth, args.objectives, true, full()), // neutral synth sees every team's objective
      deps = { synth, synthSelector, frame, prompt: args.prompt, labels, optional, templates, errors, live, liveSpeakers, full: refFull, telemetry, speakOne, record, note },
      runSynthesis = makeSynthesizer(deps),
      runElimination = makeEliminator(deps),
      runFrame = makeFramer(deps),
      runVote = makeVoter({ args, preset, rounds, budgetOk: () => !(tokenBudget && used() >= tokenBudget), liveSpeakers: voters, seen, runHidden, note, telemetry, templates })

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
      if (runVote) await runVote(round, [...turns]) // anonymous peer vote after field turns, before synthesis/elimination
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
