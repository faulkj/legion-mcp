/** Numbered candidate menu for an elimination prompt, with a `0) no elimination` row when cuts are optional. */
export const eliminationMenu = (candidates: Speaker[], labels: string[], optional: boolean): string => {
   const rows = candidates.map((s, i) => `${i + 1}) ${labels[s.index] ?? s.selector}`)
   return optional ? ['0) no elimination', ...rows].join('\n') : rows.join('\n')
}

/** The eliminator's stated reason, with the verdict token itself removed, whitespace collapsed, capped at 300 chars. */
export const eliminationReason = (reply: string): string => {
   const
      v = verdictOf(reply),
      leading = /^\s*\**\s*\d+\**\s*[\u2014\-:.)]*\s*/,
      body = v === null
         ? reply
         : leading.test(reply) && v.at < (reply.match(leading)?.[0].length ?? 0)
            ? reply.replace(leading, '')
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

// The asked-for shape is "N — reason", so a leading number IS the verdict, even if the reason mentions
// other seats. Only when the reply doesn't open with one do we look for a Cut/Eliminate line, then the
// last bare number (a model that reasons first and decides last).
const verdictOf = (reply: string): { pick: number; at: number } | null => {
   const
      leading = reply.match(/^\s*\**\s*(\d+)(?![\w.])/),
      labelled = [...reply.matchAll(/(?:cut|eliminate[sd]?|verdict|decision)\s*[:\u2014\-]?\s*\**\s*(\d+)/gi)].at(-1),
      bare = [...reply.matchAll(/(?<![\w.])(\d+)(?![\w.])/g)].at(-1),
      m = leading ?? labelled ?? bare
   return m?.index === undefined ? null : { pick: Number(m[1]), at: m.index + m[0].indexOf(m[1]!) }
}
