import { fill, slugify } from '../config/config.js'
import { makeTurnLabels } from './context.js'
import { parseSelector } from './selectors.js'

/**
 * Rerun guidance when the token budget skipped turns, or null when none were. The suggested budget
 * extrapolates spend per completed turn to every planned turn — a floor, since later turns re-send
 * a longer transcript.
 */
export const budgetShortfall = (telemetry: TurnTelemetry[], used: number, limit: number | undefined, template: string): string | null => {
   const
      skipped = telemetry.filter(t => t.status === 'skipped: budget'),
      ran = Math.max(1, telemetry.filter(t => !t.status.startsWith('skipped') && t.status !== 'cancelled').length),
      seats = [...new Set(skipped.map(t => t.selector))].join(', ')
   return !limit || !skipped.length
      ? null
      : fill(template, { limit, used, skipped: skipped.length, seats, suggested: Math.ceil(used * (ran + skipped.length) / ran / 10000) * 10000 })
}

/** Resolve a `model[:role][@team]` selector to its model def, optional role, and optional (slugified) team; null when the model or role is unknown. */
export const resolve = (selector: string, models: ModelDef[], roles: RoleDef[]): { def: ModelDef; role?: string; team?: string } | null => {
   const
      { model, role, team } = parseSelector(selector),
      def = models.find(m => slugify(m.name) === model)
   if (!def) return null
   if (role !== undefined && !roles.find(r => r.name === role)) return null
   if (team !== undefined && !team) return null
   return { def, role, team: team === undefined ? undefined : slugify(team) }
}

/**
 * Resolve `selectors` into council seats (one Speaker each, keeping order and duplicates —
 * position is the stable identity). Neutral voices (synthesizer, eliminator, framer) never speak
 * in normal rounds: an in-list neutral fills its slot from the FIRST match, an external one appends
 * a seat. A synthesizer whose role is `playing` stays in the rounds instead (its seat is chosen at
 * synthesis time). A seat whose role is in `silentRoles` is flagged `silent` (it hears everything
 * and votes, but takes no round/elimination turn — e.g. an electorate). Returns `{ bad }` for the
 * first unknown selector.
 */
export const resolveSpeakers = (selectors: string[], synthSelector: string | undefined, models: ModelDef[], roles: RoleDef[], frameSelector?: string, silentRoles?: Set<string>, roleTokens?: Map<string, number>, eliminatorSelector?: string, playing = false): ResolvedCouncil => {
   const
      seats = selectors.map((selector, index) => ({ selector, index, r: resolve(selector, models, roles) })),
      cap = (role?: string): number | undefined => role === undefined ? undefined : roleTokens?.get(role)
   for (const s of seats)
      if (s.r === null) return { speakers: [], roundSpeakers: [], labels: [], bad: s.selector }
   const
      speakers: Speaker[] = seats.map(({ selector, index, r }) => ({ index, selector, def: r!.def, role: r!.role, team: r!.team, silent: r!.role !== undefined && silentRoles?.has(r!.role), maxTokens: cap(r!.role) })),
      extras: Speaker[] = [],
      pick = (sel: string | undefined): Speaker | undefined => {
         if (sel === undefined) return undefined
         const ext = resolve(sel, models, roles)
         if (!ext) return undefined
         const seat = speakers.find(s => s.selector === sel) ?? extras.find(s => s.selector === sel)
         if (seat) return seat
         const fresh = { index: speakers.length + extras.length, selector: sel, def: ext.def, role: ext.role, team: ext.team, maxTokens: cap(ext.role) }
         return extras.push(fresh), fresh
      },
      synth = pick(synthSelector),
      eliminator = pick(eliminatorSelector),
      frame = pick(frameSelector),
      neutral = new Set([playing ? undefined : synth?.index, eliminator?.index, frame?.index].filter(i => i !== undefined)),
      roundSpeakers = speakers.filter(s => !neutral.has(s.index)),
      labels = makeTurnLabels([...speakers, ...extras])
   return { speakers, roundSpeakers, synth, eliminator, frame, labels }
}

/** Banner prepended to a turn's prompt, chosen by phase: closing statements, eliminations, and syntheses (interim for round > 0, final for round 0) get their own banner; a normal round gets the exploring/final banner, or nothing for a lone round. */
export const banner = (round: number, rounds: number, phase: TurnPhase, t: PromptTemplates): string =>
   phase === 'closing'
      ? t.closingStatement
      : phase === 'elimination'
         ? t.elimination
         : phase === 'synthesis'
            ? round === 0 ? t.synthesis : t.roundSynthesis
            : rounds < 2
               ? ''
               : fill(round < rounds ? t.roundExploring : t.roundFinal, { round, rounds })


