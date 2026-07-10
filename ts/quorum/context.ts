import { fill, slugify } from '../config/config.js'

/**
 * Build stable per-speaker display labels for the run, indexed by `Speaker.index`. Labels
 * use the ROLE, not the model, so the model-facing transcript never leaks model identity.
 * Roles staffed by 2+ speakers are numbered (`critic 1`, `critic 2`); a lone role stays
 * bare (`critic`). Role-less speakers fall back to the model slug and are NOT numbered —
 * numbering there would re-expose model identity. Numbering is keyed by first-seen order.
 */
export const makeTurnLabels = (speakers: Speaker[]): string[] => {
   const
      counts = speakers.reduce((m, s) => s.role ? m.set(s.role, (m.get(s.role) ?? 0) + 1) : m, new Map<string, number>()),
      seen = new Map<string, number>(),
      labels: string[] = []
   for (const s of speakers) {
      if (!s.role) { labels[s.index] = slugify(s.selector.split(':', 2)[0] ?? s.selector); continue }
      const n = (seen.set(s.role, (seen.get(s.role) ?? 0) + 1), seen.get(s.role)!)
      labels[s.index] = counts.get(s.role)! > 1 ? `${s.role} ${n}` : s.role
   }
   return labels
}

/**
 * Build the transcript context block from prior turns (labeled by role), appended after any
 * caller context. When `selfIndex` is given, that speaker's own turns are marked so it can
 * tell which were its own. A speaker's turns gain an `· eliminated` marker once an elimination
 * turn for that speaker appears in the same snapshot — so earlier snapshots stay unmarked.
 */
export const toContext = (turns: QuorumTurn[], labels: string[], t: PromptTemplates, callerContext?: string, selfIndex?: number): string | undefined => {
   if (!turns.length) return callerContext
   const
      eliminated = new Set(turns.filter(turn => turn.phase === 'elimination').map(turn => turn.index)),
      phaseTag = (turn: QuorumTurn): string =>
         turn.phase === 'closing'
            ? 'closing'
            : turn.phase === 'synthesis'
               ? 'synthesis'
               : turn.phase === 'elimination'
                  ? 'elimination'
                  : `round ${turn.round}`,
      mark = (turn: QuorumTurn): string =>
         `${turn.index === selfIndex ? ' · you' : ''}${turn.phase !== 'elimination' && eliminated.has(turn.index) ? ' · eliminated' : ''}`,
      label = (turn: QuorumTurn): string => `${labels[turn.index] ?? turn.selector}${mark(turn)}`,
      transcript = turns.map(turn => `[${phaseTag(turn)} / ${label(turn)}]\n${turn.text}`).join('\n\n'),
      block = fill(t.transcriptBlock, { transcript })
   return callerContext ? `${callerContext}\n\n${block}` : block
}

/** Normalize `synthesizeEvery` to a round interval: a positive number→itself, `0`/`end`/undefined→Infinity (last round only). */
export const everyN = (v: SynthesizeEvery | undefined): number =>
   typeof v === 'number' && v > 0 ? v : Infinity
