import { fill, slugify } from '../config/config.js'
import { parseSelector } from './selectors.js'

/**
 * Build stable per-speaker display labels for the run, indexed by `Speaker.index`. Labels
 * use the ROLE, not the model, so the model-facing transcript never leaks model identity.
 * A role staffed by 2+ speakers WITHIN the same team is numbered (`combatant 1`, `combatant 2`);
 * a lone role stays bare (`critic`). Team-tagged speakers get a `[team] ` prefix so allies and
 * opponents are legible. Role-less speakers fall back to the model slug and are NOT numbered —
 * numbering there would re-expose model identity. Numbering is keyed by first-seen order.
 */
export const makeTurnLabels = (speakers: Speaker[]): string[] => {
   const
      key = (s: Speaker) => `${s.team ?? ''}|${s.role}`,
      counts = speakers.reduce((m, s) => s.role ? m.set(key(s), (m.get(key(s)) ?? 0) + 1) : m, new Map<string, number>()),
      seen = new Map<string, number>(),
      prefix = (s: Speaker) => s.team ? `[${s.team}] ` : '',
      labels: string[] = []
   for (const s of speakers) {
      if (!s.role) { labels[s.index] = `${prefix(s)}${slugify(parseSelector(s.selector).model)}`; continue }
      const n = (seen.set(key(s), (seen.get(key(s)) ?? 0) + 1), seen.get(key(s))!)
      labels[s.index] = `${prefix(s)}${counts.get(key(s))! > 1 ? `${s.role} ${n}` : s.role}`
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
      eliminated = new Set(turns.filter(turn => turn.phase === 'elimination' && turn.text.endsWith(' eliminated')).map(turn => turn.index)),
      phaseTag = (turn: QuorumTurn): string =>
         turn.phase === 'round' ? `round ${turn.round}` : turn.phase,
      mark = (turn: QuorumTurn): string =>
         `${turn.index === selfIndex ? ' · you' : ''}${turn.phase !== 'elimination' && eliminated.has(turn.index) ? ' · eliminated' : ''}`,
      label = (turn: QuorumTurn): string => `${labels[turn.index] ?? turn.selector}${mark(turn)}`,
      transcript = turns.map(turn => `[${phaseTag(turn)} / ${label(turn)}]\n${turn.text}`).join('\n\n'),
      block = fill(t.transcriptBlock, { transcript })
   return callerContext ? `${callerContext}\n\n${block}` : block
}

/**
 * Build the per-speaker round-context function for a mode: `independent` sees only caller context,
 * `private` sees only its own prior turns, others see the whole snapshot. The speaker's own turns
 * are self-marked and its team objective (via `withObjective`) is prepended.
 */
export const makeSeen = (
   mode: QuorumMode,
   labels: string[],
   templates: PromptTemplates,
   callerContext: string | undefined,
   objectives: Record<string, string> | undefined,
   withObjective: (s: Speaker | undefined, o: Record<string, string> | undefined, isRef: boolean, ctx?: string) => string | undefined
): ((speaker: Speaker, snapshot: QuorumTurn[]) => string | undefined) =>
   (speaker, snapshot) =>
      withObjective(speaker, objectives, false,
         mode === 'independent'
            ? callerContext
            : mode === 'private'
               ? toContext(snapshot.filter(t => t.index === speaker.index), labels, templates, callerContext, speaker.index)
               : toContext(snapshot, labels, templates, callerContext, speaker.index))

/** Normalize `synthesizeEvery` to a round interval: a positive number→itself, `0`/`end`/undefined→Infinity (last round only). */
export const everyN = (v: SynthesizeEvery | undefined): number =>
   typeof v === 'number' && v > 0 ? v : Infinity
