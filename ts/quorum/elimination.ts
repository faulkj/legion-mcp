/** Numbered candidate menu for an elimination prompt, with a `0) no elimination` row when cuts are optional. */
export const eliminationMenu = (candidates: Speaker[], labels: string[], optional: boolean): string => {
   const rows = candidates.map((s, i) => `${i + 1}) ${labels[s.index] ?? s.selector}`)
   return optional ? ['0) no elimination', ...rows].join('\n') : rows.join('\n')
}

/** The eliminator's stated reason, with the verdict token itself removed, whitespace collapsed, capped at 300 chars. */
export const eliminationReason = (reply: string): string => {
   const
      v = verdictOf(reply),
      body = v === null
         ? reply
         : v.at === reply.search(/\S/)
            ? reply.replace(/^\s*\d+\s*[\u2014\-:.)]*\s*/, '')
            : reply.slice(0, v.at) + reply.slice(v.at).replace(/^[^\n]*/, '')
   return body.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** Resolve an elimination reply to the chosen candidate, `'none'` for an optional pass, or null when unparseable or out of range. */
export const parseElimination = (reply: string, candidates: Speaker[], optional: boolean): Speaker | 'none' | null => {
   const v = verdictOf(reply)
   if (v === null) return null
   return optional && v.pick === 0
      ? 'none'
      : v.pick >= 1 && v.pick <= candidates.length
         ? candidates[v.pick - 1]!
         : null
}

// A model may reason first and decide last ("2 … on reflection, cut: 1"), so the verdict is an explicit
// Cut/Eliminate line when present, else the LAST bare number — never the first digit it happens to emit.
const verdictOf = (reply: string): { pick: number; at: number } | null => {
   const
      labelled = [...reply.matchAll(/(?:cut|eliminate[sd]?|verdict|decision)\s*[:\u2014\-]?\s*\**\s*(\d+)/gi)].at(-1),
      bare = [...reply.matchAll(/(?<![\w.])(\d+)(?![\w.])/g)].at(-1),
      m = labelled ?? bare
   return m?.index === undefined ? null : { pick: Number(m[1]), at: m.index }
}
