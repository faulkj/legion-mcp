import { fill, slugify } from '../config/config.js'
import { makeTurnLabels } from './context.js'
import { parseSelector } from './selectors.js'

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
 * position is the stable identity). Neutral voices (synthesizer, framer) never speak in normal
 * rounds: an in-list neutral fills its slot from the FIRST match, an external one appends a seat.
 * A seat whose role is in `silentRoles` is flagged `silent` (it hears everything and votes, but
 * takes no round/elimination turn — e.g. an electorate). Returns `{ bad }` for the first unknown selector.
 */
export const resolveSpeakers = (selectors: string[], synthSelector: string | undefined, models: ModelDef[], roles: RoleDef[], frameSelector?: string, silentRoles?: Set<string>): ResolvedCouncil => {
   const seats = selectors.map((selector, index) => ({ selector, index, r: resolve(selector, models, roles) }))
   for (const s of seats)
      if (s.r === null) return { speakers: [], roundSpeakers: [], labels: [], bad: s.selector }
   const
      speakers: Speaker[] = seats.map(({ selector, index, r }) => ({ index, selector, def: r!.def, role: r!.role, team: r!.team, silent: r!.role !== undefined && silentRoles?.has(r!.role) })),
      pick = (sel: string | undefined, at: number): Speaker | undefined => {
         if (sel === undefined) return undefined
         const ext = resolve(sel, models, roles)
         return speakers.find(s => s.selector === sel) ?? (ext ? { index: at, selector: sel, def: ext.def, role: ext.role, team: ext.team } : undefined)
      },
      synth = pick(synthSelector, speakers.length),
      frame = pick(frameSelector, synth && synth.index >= speakers.length ? speakers.length + 1 : speakers.length),
      neutral = new Set([synth?.index, frame?.index].filter(i => i !== undefined)),
      roundSpeakers = speakers.filter(s => !neutral.has(s.index)),
      extras = [synth, frame].filter((s): s is Speaker => s !== undefined && s.index >= speakers.length),
      labels = makeTurnLabels([...speakers, ...extras])
   return { speakers, roundSpeakers, synth, frame, labels }
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


