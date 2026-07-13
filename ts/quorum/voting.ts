import { everyN } from './context.js'

/**
 * Build the anonymous peer-vote step, or undefined when no ballot is configured. On a due round,
 * every eligible voter casts a hidden freeform ballot in parallel (each seeing the transcript
 * through its own mode context, like a normal round), then the ballots are tallied into a single
 * anonymous transcript note. Individual ballots never enter content or the transcript; per-voter
 * telemetry carries only a sanitized status, so who voted for what is never recoverable.
 */
export const makeVoter = (deps: VoteDeps): ((round: number, snapshot: QuorumTurn[]) => Promise<void>) | undefined => {
   const
      { args, preset, rounds, budgetOk, liveSpeakers, seen, runHidden, note, telemetry, templates } = deps,
      ballot = preset?.vote ?? args.vote,
      voteEvery = preset?.voteEvery ?? args.voteEvery,
      visibility = preset?.voteVisibility ?? args.voteVisibility ?? 'aggregate'
   if (ballot === undefined) return undefined
   return async (round: number, snapshot: QuorumTurn[]): Promise<void> => {
      const voters = liveSpeakers()
      if (!voteDue(voteEvery, round, rounds) || voters.length === 0 || !budgetOk()) return
      const outcomes = await runHidden(voters, round, 'vote', s => seen(s, snapshot), () => templates.vote + ballot)
      for (const o of outcomes) telemetry.push(sanitizeBallot(o.entry, o.text))
      const { turn, entry } = tallyBallots(outcomes, round, visibility)
      note(turn, entry)
   }
}

const
   norm = (t: string): string => t.trim().split('\n')[0]!.trim().toLowerCase().replace(/\s+/g, ' '),

   isAbstain = (t: string | null): boolean => t === null || ['abstain', 'none', 'no vote', ''].includes(norm(t)),

   voteDue = (voteEvery: SynthesizeEvery | undefined, round: number, rounds: number): boolean => {
      const interval = everyN(voteEvery)
      return interval === Infinity ? round === rounds : round % interval === 0 || round === rounds
   },

   sanitizeBallot = (entry: TurnTelemetry, text: string | null): TurnTelemetry => ({
      ...entry,
      status: text === null ? 'error' : isAbstain(text) ? 'abstained' : 'vote recorded',
      contentIndex: undefined
   }),

   tallyBallots = (outcomes: TurnOutcome[], round: number, visibility: VoteVisibility): { turn: QuorumTurn; entry: TurnTelemetry } => {
      const
         cast = outcomes.map(o => o.text).filter((t): t is string => !isAbstain(t)),
         abstained = outcomes.length - cast.length,
         groups = [...cast.reduce((m, t) => m.set(norm(t), (m.get(norm(t)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]),
         tally = groups.map(([label, n]) => `${n} × ${label}`).join('\n') || '(no votes cast)',
         ballots = visibility === 'ballots' ? `\n\n--- Ballots ---\n${cast.map(t => `• ${t.trim().replace(/\s+/g, ' ')}`).join('\n')}` : '',
         text = `[anonymous vote — ${cast.length} cast, ${abstained} abstained]\n${tally}${ballots}`,
         status = `vote tallied: ${cast.length} cast, ${abstained} abstained`
      return {
         turn: { index: -1, selector: 'anonymous vote', round, phase: 'vote', text },
         entry: { index: -1, selector: 'anonymous vote', modelName: '', modelId: '', round, phase: 'vote', usage: {}, latencyMs: 0, status }
      }
   }
