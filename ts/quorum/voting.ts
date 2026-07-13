import { everyN } from './context.js'

/**
 * Build the anonymous peer-vote step, or undefined when no ballot is configured. On a due round
 * every eligible voter casts a hidden ballot in parallel, choosing from a numbered menu of the
 * candidates (its own seat is included unless the preset sets `allowSelfVote: false`, e.g. a
 * peer-judgment "who's weakest" cut), then the picks are tallied into one anonymous transcript
 * note. Ballots never enter content or the transcript and are redacted from logs; per-voter
 * telemetry carries only a sanitized status, so who voted for what is never recoverable. A voter
 * with no available candidate abstains.
 */
export const makeVoter = (deps: VoteDeps): ((round: number, snapshot: QuorumTurn[]) => Promise<void>) | undefined => {
   const
      { args, preset, rounds, budgetOk, liveSpeakers, candidates, labels, seen, runHidden, note, telemetry, templates } = deps,
      ballot = preset?.vote ?? args.vote,
      voteEvery = preset?.voteEvery ?? args.voteEvery,
      visibility = preset?.voteVisibility ?? args.voteVisibility ?? 'aggregate',
      selfVote = (preset?.allowSelfVote ?? args.allowSelfVote) !== false
   if (ballot === undefined) return undefined
   return async (round: number, snapshot: QuorumTurn[]): Promise<void> => {
      const
         voters = liveSpeakers(),
         field = candidates()
      if (!voteDue(voteEvery, round, rounds) || voters.length === 0 || !budgetOk()) return
      const
         menuFor = (voter: Speaker): Speaker[] => selfVote ? field : field.filter(c => c.index !== voter.index),
         outcomes = await runHidden(voters, round, 'vote', s => seen(s, snapshot), voter => templates.vote + ballot + '\n\n' + voteMenu(menuFor(voter), labels)),
         picks = voters.map((voter, i) => parseVote(outcomes[i]!.text, menuFor(voter), labels))
      for (const o of outcomes) telemetry.push(sanitizeBallot(o.entry))
      note(...tally(picks, round, visibility))
   }
}

const
   voteMenu = (menu: Speaker[], labels: string[]): string =>
      ['0) abstain', ...menu.map((s, i) => `${i + 1}) ${labels[s.index] ?? s.selector}`)].join('\n'),

   // Parse a ballot to a canonical candidate label (or null = abstain). The first integer indexes the voter's OWN menu.
   parseVote = (reply: string | null, menu: Speaker[], labels: string[]): string | null => {
      const match = reply?.match(/\d+/)
      if (!match) return null
      const pick = Number(match[0])
      return pick >= 1 && pick <= menu.length ? (labels[menu[pick - 1]!.index] ?? menu[pick - 1]!.selector) : null
   },

   voteDue = (voteEvery: SynthesizeEvery | undefined, round: number, rounds: number): boolean => {
      const interval = everyN(voteEvery)
      return interval === Infinity ? round === rounds : round % interval === 0 || round === rounds
   },

   sanitizeBallot = (entry: TurnTelemetry): TurnTelemetry => ({
      ...entry,
      status: entry.status.startsWith('error') ? 'error' : 'ballot cast',
      contentIndex: undefined
   }),

   tally = (picks: (string | null)[], round: number, visibility: VoteVisibility): [QuorumTurn, TurnTelemetry] => {
      const
         cast = picks.filter((p): p is string => p !== null),
         abstained = picks.length - cast.length,
         groups = [...cast.reduce((m, p) => m.set(p, (m.get(p) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]),
         tallied = groups.map(([label, n]) => `${n} × ${label}`).join('\n') || '(no votes cast)',
         detail = visibility === 'ballots' ? `\n\n--- Ballots ---\n${cast.map(p => `• ${p}`).join('\n')}` : '',
         text = `[anonymous vote — ${cast.length} cast, ${abstained} abstained]\n${tallied}${detail}`,
         status = `vote tallied: ${cast.length} cast, ${abstained} abstained`
      return [
         { index: -1, selector: 'anonymous vote', round, phase: 'vote', text },
         { index: -1, selector: 'anonymous vote', modelName: '', modelId: '', round, phase: 'vote', usage: {}, latencyMs: 0, status }
      ]
   }
