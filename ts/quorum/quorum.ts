import { fill } from '../config/config.js'
import { log } from '../core/log.js'
import { makeSeen, toContext } from './context.js'
import { entrantFirst, entryDue, makeEntry, makeField, nextEntrant, recordEntry, rotateTeams, withObjective } from './entry.js'
import { chaseToOne, eliminationDue, frameDue, makeCloser, makeEliminator, makeFramer, makeSynthesizer } from './phases.js'
import { presetError, validatePreset } from './preset.js'
import { makeTurnRunner } from './runner.js'
import { resolveConfig, staffCouncil } from './setup.js'
import { buildTimeline } from './timeline.js'
import { makeVoter } from './voting.js'

/** Run one council: staff the seats, drive every round and phase, and return the turns plus run telemetry. */
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
   presets: Presets = {},
   report: ReportPhase = () => {}
): Promise<{ content: { type: 'text'; text: string }[]; structuredContent?: unknown; isError: boolean }> => {
   const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

   if (args.roles && Object.keys(args.roles).length && !dynamicRoles)
      return err(errors.adhocDisabled)

   const config = resolveConfig(args, models, roles, presets, maxRounds)
   if (config.adHocEmpty) return err(errors.adhocEmptyName)
   if (config.error) return err(errors[config.error])

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, args.models, presets, models, roles), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   const { speakers, roundSpeakers, synth, frame, labels, error } = staffCouncil(args, config, models, errors)
   if (error) return err(error)

   const
      { preset, effectiveRoles, rounds, mode, synthSelector, synthInterval, reframeEvery, closing, eliminateEvery, enterEvery, optional, cameoRound } = config,
      { telemetry, turns, content, used, speakOne, record, note, skip, runParallel, runHidden } = makeTurnRunner(args, effectiveRoles, roundSpeakers, rounds, prompt, templates),
      live = new Set(roundSpeakers.map(s => s.index)),
      entry = makeEntry(roundSpeakers, enterEvery),
      { tagTeamRoles, onCard, regulars, voters, liveSpeakers, candidates } = makeField(roundSpeakers, live, entry, preset, cameoRound),
      full = () => toContext(turns, labels, templates, args.context),
      closingContext = (speaker: Speaker) => withObjective(speaker, args.objectives, false, toContext(turns, labels, templates, args.context, speaker.index)),
      seen = makeSeen(mode, labels, templates, args.context, args.objectives, withObjective),
      refFull = () => withObjective(synth, args.objectives, true, full()),
      deps = { synth, synthSelector, frame, prompt: args.prompt, labels, optional, templates, errors, live, liveSpeakers: regulars, full: refFull, telemetry, speakOne, record, note },
      runSynthesis = makeSynthesizer(deps),
      runElimination = makeEliminator(deps),
      runFrame = makeFramer(deps),
      runClosing = makeCloser({ roles: preset?.roles ?? [], rounds, budgetOk: () => !(tokenBudget && used() >= tokenBudget), speakers: regulars, context: closingContext, runParallel, speakOne, record, skip }),
      runVote = makeVoter({ args, preset, rounds, budgetOk: () => !(tokenBudget && used() >= tokenBudget), liveSpeakers: voters, candidates, voteByTeam: preset?.voteByTeam === true, labels, seen, runHidden, note, telemetry, templates })

   for (let round = 1; round <= rounds; round++) {
      await report(`round ${round}/${rounds}`)
      if (tokenBudget && used() >= tokenBudget) {
         for (let r = round; r <= rounds; r++) skip(r, 0, 'round', rotateTeams(liveSpeakers(), tagTeamRoles, r))
         log('warn', `⚠️ token budget ${tokenBudget} exceeded (${used()}) — skipping remaining turns`)
         break
      }
      if (frameDue(reframeEvery, round)) await runFrame(round)
      const
         entrant = entryDue(entry, enterEvery, round) ? nextEntrant(entry) : undefined,
         entrantPrompt = (s: Speaker): string | undefined => s.index === entrant?.index ? templates.entrant + args.prompt : undefined
      if (entrant) recordEntry(note, entrant, round, labels[entrant.index] ?? entrant.selector)
      const speaking = entrantFirst(onCard(rotateTeams(liveSpeakers(), tagTeamRoles, round), round), entrant)
      if (mode === 'sequential')
         for (let i = 0; i < speaking.length; i++) {
            if (tokenBudget && used() >= tokenBudget) { skip(round, i, 'round', speaking); break }
            record(await speakOne(speaking[i]!, round, 'round', seen(speaking[i]!, turns), entrantPrompt(speaking[i]!)), round)
         }
      else {
         const snapshot = [...turns]
         await runParallel(speaking, round, 'round', s => seen(s, snapshot), entrantPrompt)
      }
      if (runVote && !(closing && round === rounds)) await runVote(round, [...turns])
      if (synthInterval !== Infinity && (round % synthInterval === 0 || round === rounds) && !(closing && round === rounds))
         await runSynthesis(round)
      if (eliminationDue(eliminateEvery, round)) await runElimination(round)
      if (eliminateEvery !== undefined && regulars().length <= 1) break
   }

   await chaseToOne(eliminateEvery, rounds, regulars, runElimination, report)

   if (closing)
      await report('closing statements'), await runClosing()
   if (closing && runVote) await runVote(rounds, [...turns])

   if (synthInterval === Infinity || closing)
      await report('synthesizing'), await runSynthesis(0)

   const synthFailed = synthSelector !== undefined && telemetry.findLast(t => t.phase === 'synthesis')?.contentIndex === undefined

   return {
      content: synthFailed ? [...content, { type: 'text' as const, text: fill(errors.synthFailed, { synth: synthSelector! }) }] : content,
      structuredContent: {
         turns: telemetry,
         timeline: buildTimeline(telemetry, labels),
         transcript: toContext(turns, labels, templates) ?? '',
         ...(args.preset ? { preset: args.preset } : {}),
         ...(tokenBudget ? { budget: { limit: tokenBudget, used: used(), exceeded: used() > tokenBudget } } : {})
      },
      isError: content.length === 0 || synthFailed
   }
}
