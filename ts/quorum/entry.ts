/**
 * Set up staggered entry for a run. When `enterEvery` is positive AND the round speakers carry
 * team tags, the field starts with one speaker per team (first-seen team order) plus any teamless
 * neutrals (e.g. a framer), and the rest are benched in round-robin team order so entries alternate
 * sides. Otherwise entry is inactive and every speaker is entered from round 1 (today's behavior).
 * Returns the entered set, bench queue, and whether entry is active.
 */
export const makeEntry = (roundSpeakers: Speaker[], enterEvery: number | undefined): Entry => {
   const teams = [...new Set(roundSpeakers.map(s => s.team).filter((t): t is string => t !== undefined))]
   if (!enterEvery || enterEvery < 1 || teams.length < 2)
      return { entered: new Set(roundSpeakers.map(s => s.index)), queue: [], active: false }
   const
      byTeam = teams.map(t => roundSpeakers.filter(s => s.team === t)),
      neutral = roundSpeakers.filter(s => s.team === undefined),
      starters = [...neutral, ...byTeam.map(members => members[0]!)],
      benched = roundRobin(byTeam.map(members => members.slice(1)))
   return { entered: new Set(starters.map(s => s.index)), queue: benched, active: true }
}

/** Whether a new entrant joins at the start of `round`: never on round 1 (starters only), then every `enterEvery` rounds while the bench holds someone. */
export const entryDue = (entry: Entry, enterEvery: number | undefined, round: number): boolean =>
   entry.active && entry.queue.length > 0 && round > 1 && (round - 1) % (enterEvery || 1) === 0

/** Pull the next entrant off the bench into the entered set, returning it (or undefined if the bench is empty). */
export const nextEntrant = (entry: Entry): Speaker | undefined => {
   const next = entry.queue.shift()
   if (next) entry.entered.add(next.index)
   return next
}

/** Order an entry round's speakers so the new entrant speaks first, then the rest in seat order. */
export const entrantFirst = (speaking: Speaker[], entrant: Speaker | undefined): Speaker[] =>
   entrant === undefined ? speaking : [entrant, ...speaking.filter(s => s.index !== entrant.index)]

/** Validate a call's team objectives: teamless runs need none; team runs need >= 2 teams, an objective per team, and no objective for an unknown team. Returns an error string or null. */
export const objectiveError = (roundSpeakers: Speaker[], objectives: Record<string, string> | undefined): string | null => {
   const teams = [...new Set(roundSpeakers.map(s => s.team).filter((t): t is string => t !== undefined))]
   if (teams.length === 0) return null
   if (teams.length < 2) return `team runs need at least 2 teams — found only "${teams[0]}".`
   const keys = Object.keys(objectives ?? {})
   for (const t of teams)
      if (!keys.includes(t)) return `team "${t}" has no objective — supply one via objectives.`
   for (const k of keys)
      if (!teams.includes(k)) return `objective for unknown team "${k}" — teams are: ${teams.join(', ')}.`
   return null
}

/**
 * Prepend a team-objective block to `ctx`: for the neutral ref, every team's objective; for a
 * team member, only its own team's objective; nothing for teamless speakers or objective-free runs.
 */
export const withObjective = (speaker: Speaker | undefined, objectives: Record<string, string> | undefined, isRef: boolean, ctx?: string): string | undefined => {
   const block = !objectives || !Object.keys(objectives).length
      ? undefined
      : isRef
         ? `--- Team objectives ---\n${Object.entries(objectives).map(([t, o]) => `[${t}] ${o}`).join('\n')}`
         : speaker?.team && objectives[speaker.team]
            ? `--- Your team's objective ([${speaker.team}]) ---\n${objectives[speaker.team]}`
            : undefined
   return block ? (ctx ? `${block}\n\n${ctx}` : block) : ctx
}

/** Record a staggered-entry event as a neutral transcript note (no answer content) plus telemetry. */
export const recordEntry = (note: TurnRunner['note'], entrant: Speaker, round: number, label: string): void =>
   note(
      { index: entrant.index, selector: entrant.selector, round, phase: 'entry', text: 'entered' },
      { index: entrant.index, selector: entrant.selector, modelName: entrant.def.name, modelId: entrant.def.model, role: entrant.role, round, phase: 'entry', usage: {}, latencyMs: 0, status: `entered: ${label}` }
   )

const roundRobin = (lists: Speaker[][]): Speaker[] => {
   const out: Speaker[] = []
   for (let i = 0; out.length < lists.reduce((n, l) => n + l.length, 0); i++)
      for (const list of lists)
         if (list[i]) out.push(list[i]!)
   return out
}
