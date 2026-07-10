import { fill, slugify } from '../config/config.js'
import { resolve } from './helpers.js'

/**
 * Build a stable selector→display-label map for the run. Labels use the ROLE, not the
 * model, so the model-facing transcript never leaks model identity. Roles staffed by 2+
 * selectors are numbered (`critic 1`, `critic 2`); a lone role stays bare (`critic`).
 * Role-less selectors fall back to the model slug. Numbering is keyed by first-seen order
 * in `selectors` so it stays stable across rounds regardless of speak order.
 */
export const makeTurnLabels = (selectors: string[], models: ModelDef[], roles: RoleDef[]): Map<string, string> => {
   const
      roleOf = (s: string) => resolve(s, models, roles)?.role ?? null,
      counts = selectors.reduce((m, s) => {
         const role = roleOf(s)
         return role ? m.set(role, (m.get(role) ?? 0) + 1) : m
      }, new Map<string, number>()),
      seen = new Map<string, number>()
   return new Map(selectors.map(s => {
      const role = roleOf(s)
      if (!role) return [s, slugify(s.split(':', 2)[0] ?? s)]
      const n = (seen.set(role, (seen.get(role) ?? 0) + 1), seen.get(role)!)
      return [s, counts.get(role)! > 1 ? `${role} ${n}` : role]
   }))
}

/** Build the transcript context block from prior turns (labeled by role), appended after any caller context. */
export const toContext = (turns: QuorumTurn[], labels: Map<string, string>, t: PromptTemplates, callerContext?: string): string | undefined => {
   if (!turns.length) return callerContext
   const
      transcript = turns.map(turn => `[round ${turn.round} / ${labels.get(turn.selector) ?? turn.selector}]\n${turn.text}`).join('\n\n'),
      block = fill(t.transcriptBlock, { transcript })
   return callerContext ? `${callerContext}\n\n${block}` : block
}

/** Normalize `synthesizeEvery` to a round interval: a positive number→itself, `0`/`end`/undefined→Infinity (last round only). */
export const everyN = (v: SynthesizeEvery | undefined): number =>
   typeof v === 'number' && v > 0 ? v : Infinity
