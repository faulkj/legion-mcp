/** Exact-label commands for the eligible candidates, plus `KEEP ALL` when cuts are optional. */
export const eliminationMenu = (candidates: Speaker[], labels: string[], optional: boolean): string => {
   const rows = candidates.map(s => `CUT ${labels[s.index] ?? s.selector}`)
   return optional ? ['KEEP ALL', ...rows].join('\n') : rows.join('\n')
}

/** Return the reason after a valid command line, or the malformed reply, shortened on a word boundary with a visible `[…]` marker past 300 characters. */
export const eliminationReason = (reply: string): string => {
   const text = (verdictOf(reply)?.reason ?? reply).replace(/\s+/g, ' ').trim()
   return text.length <= 300 ? text : `${text.slice(0, 300).replace(/\s+\S*$/, '')} […]`
}

/** Resolve one exact command to a unique eligible candidate, an optional pass, or null without guessing. */
export const parseElimination = (reply: string, candidates: Speaker[], labels: string[], optional: boolean): Speaker | 'none' | null => {
   const v = verdictOf(reply)
   if (v === null) return null
   if (v.label === undefined) return optional ? 'none' : null
   const matches = candidates.filter(s => (labels[s.index] ?? s.selector) === v.label)
   return matches.length === 1 ? matches[0]! : null
}

const verdictOf = (reply: string): { label?: string; reason: string } | null => {
   const
      [command = '', ...rest] = reply.trim().split(/\r?\n/),
      label = command.match(/^CUT (.+)$/)?.[1],
      reason = rest.join('\n')
   if (!reason.trim() || (label === undefined && command !== 'KEEP ALL') || rest.some(line => /^(?:CUT\s|KEEP ALL\b)/i.test(line.trim()))) return null
   return { label, reason }
}
