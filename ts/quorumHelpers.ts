import { fill, slugify } from './config.js'

/** Resolve a `model` or `model:role` selector to its model def and optional role; null when unknown. */
export const resolve = (selector: string, models: ModelDef[], roles: RoleDef[]): { def: ModelDef; role?: string } | null => {
   const
      [modelPart, rolePart] = selector.split(':', 2) as [string, string | undefined],
      def = models.find(m => slugify(m.name) === modelPart)
   if (!def) return null
   if (rolePart !== undefined && !roles.find(r => r.name === rolePart)) return null
   return { def, role: rolePart }
}

/** Remove duplicate selectors, preserving first-seen order. */
export const dedup = (selectors: string[]): string[] => [...new Set(selectors)]

/** Round/synthesis banner prepended to a turn's prompt; empty for a single non-synthesis round. */
export const banner = (round: number, rounds: number, isSynthesis: boolean, t: PromptTemplates): string =>
   isSynthesis
      ? t.synthesis
      : rounds < 2
         ? ''
         : fill(round < rounds ? t.roundExploring : t.roundFinal, { round, rounds })

/** Build the transcript context block from prior turns, appended after any caller context. */
export const toContext = (turns: QuorumTurn[], t: PromptTemplates, callerContext?: string): string | undefined => {
   if (!turns.length) return callerContext
   const
      transcript = turns.map(turn => `[round ${turn.round} / ${turn.selector}]\n${turn.text}`).join('\n\n'),
      block = fill(t.transcriptBlock, { transcript })
   return callerContext ? `${callerContext}\n\n${block}` : block
}
