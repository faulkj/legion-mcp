import { fill } from '../config/config.js'
import { log } from '../core/log.js'
import { makeSeen, toContext } from './context.js'
import { entrantFirst, entryDue, makeEntry, makeField, nextEntrant, recordEntry, rotateTeams, withObjective } from './entry.js'
import { chaseToOne, eliminationDue, frameDue, makeCloser, makeEliminator, makeFramer, makeSynthesizer } from './phases.js'
import { makeTurnRunner } from './runner.js'
import { buildTimeline } from './timeline.js'
import { makeVoter } from './voting.js'

export { isQuorumError, prepareQuorum } from './prepare.js'

/**
 * Run one prepared council: drive every round and phase, and return the turns plus run telemetry.
 * `signal` cancels cooperatively — in-flight calls are aborted, no new calls start, and whatever
 * completed is returned marked incomplete. `onRunner` receives the live engine so a caller can
 * project snapshots while the run is in progress.
 */
export const runQuorum = async (
   { args, config, council }: PreparedQuorum,
   prompt: Prompt,
   templates: PromptTemplates,
   errors: ErrorMessages,
   tokenBudget?: number,
   report: ReportPhase = () => {},
   signal?: AbortSignal,
   onRunner: (runner: TurnRunner, labels: string[]) => void = () => {},
   runId?: string
): Promise<QuorumResult> => {
   let contestNotice = ''
   const
      { roundSpeakers, synth, frame, labels } = council,
      { preset, effectiveRoles, rounds, mode, synthSelector, synthInterval, reframeEvery, closing, eliminateEvery, enterEvery, optional, cameoRound } = config,
      runner = makeTurnRunner(args, effectiveRoles, roundSpeakers, rounds, prompt, templates, signal, runId),
      { telemetry, turns, content, used, cancelled, setPhase, speakOne, record, note, skip, runParallel, runHidden } = runner,
      step: ReportPhase = message => (setPhase(message), report(message)),
      live = new Set(roundSpeakers.map(s => s.index)),
      entry = makeEntry(roundSpeakers, enterEvery),
      { tagTeamRoles, onCard, regulars, voters, liveSpeakers, candidates } = makeField(roundSpeakers, live, entry, preset, cameoRound),
      full = () => toContext(turns, labels, templates, args.context),
      closingContext = (speaker: Speaker) => withObjective(speaker, args.objectives, false, toContext(turns, labels, templates, args.context, speaker.index)),
      seen = makeSeen(mode, labels, templates, args.context, args.objectives, withObjective),
      refFull = () => [withObjective(synth, args.objectives, true, full()), contestNotice].filter(Boolean).join('\n\n') || undefined,
      deps = { synth, synthSelector, frame, prompt: args.prompt, labels, optional, templates, errors, live, liveSpeakers: regulars, full: refFull, telemetry, cancelled, speakOne, record, note },
      runSynthesis = makeSynthesizer(deps),
      runElimination = makeEliminator(deps),
      runFrame = makeFramer(deps),
      runClosing = makeCloser({ roles: preset?.roles ?? [], rounds, budgetOk: () => !(tokenBudget && used() >= tokenBudget), speakers: regulars, context: closingContext, runParallel, speakOne, record, skip }),
      runVote = makeVoter({ args, preset, rounds, budgetOk: () => !(tokenBudget && used() >= tokenBudget), liveSpeakers: voters, candidates, voteByTeam: preset?.voteByTeam === true, labels, seen, runHidden, note, telemetry, templates })

   onRunner(runner, labels)

   for (let round = 1; round <= rounds && !cancelled(); round++) {
      await step(`round ${round}/${rounds}`)
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
            if (cancelled()) { skip(round, i, 'round', speaking, 'cancelled'); break }
            if (tokenBudget && used() >= tokenBudget) { skip(round, i, 'round', speaking); break }
            record(await speakOne(speaking[i]!, round, 'round', seen(speaking[i]!, turns), entrantPrompt(speaking[i]!)), round)
         }
      else {
         const snapshot = [...turns]
         await runParallel(speaking, round, 'round', s => seen(s, snapshot), entrantPrompt)
      }
      if (cancelled()) break
      if (runVote && !(closing && round === rounds)) await step('voting'), await runVote(round, [...turns])
      if (synthInterval !== Infinity && (round % synthInterval === 0 || round === rounds) && !(closing && round === rounds) && !cancelled())
         await step('interim synthesis'), await runSynthesis(round)
      if (eliminationDue(eliminateEvery, round, rounds, roundSpeakers.length) && !cancelled()) await step('elimination'), await runElimination(round)
      if (eliminateEvery !== undefined && regulars().length <= 1) break
   }

   if (!cancelled()) await chaseToOne(eliminateEvery, rounds, regulars, runElimination, step)

   const remaining = !optional && eliminateEvery !== undefined && eliminateEvery !== 0 && regulars().length > 1
      ? regulars().map(s => labels[s.index] ?? s.selector)
      : []
   if (remaining.length) contestNotice = fill(templates.incompleteContest, { remaining: remaining.join(', ') })

   if (closing && !cancelled())
      await step('closing statements'), await runClosing()
   if (closing && runVote && !cancelled()) await step('voting'), await runVote(rounds, [...turns])

   if ((synthInterval === Infinity || closing || remaining.length) && !cancelled())
      await step('synthesizing'), await runSynthesis(0)

   const
      synthFailed = !cancelled() && synthSelector !== undefined && telemetry.findLast(t => t.phase === 'synthesis')?.contentIndex === undefined,
      tail = cancelled()
         ? [{ type: 'text' as const, text: errors.cancelled }]
         : synthFailed ? [{ type: 'text' as const, text: fill(errors.synthFailed, { synth: synthSelector! }) }] : []

   await step(cancelled()
      ? 'cancelled'
      : remaining.length
         ? 'incomplete'
         : 'done')
   return {
      content: [...content, ...tail, ...(!cancelled() && contestNotice ? [{ type: 'text' as const, text: contestNotice }] : [])],
      structuredContent: {
         turns: telemetry,
         timeline: buildTimeline(telemetry, labels),
         transcript: toContext(turns, labels, templates) ?? '',
         ...(args.preset ? { preset: args.preset } : {}),
         ...(!cancelled() && remaining.length ? { incomplete: { reason: 'elimination-stalled' as const, remaining } } : {}),
         ...(tokenBudget ? { budget: { limit: tokenBudget, used: used(), exceeded: used() > tokenBudget } } : {}),
         ...(cancelled() ? { cancelled: true } : {})
      },
      isError: content.length === 0 || synthFailed || cancelled() || remaining.length > 0
   }
}
