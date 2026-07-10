/**
 * Parse a selector into its `model`, optional `role`, and optional `team`. The team tag is
 * split on the first `@`, then the remaining left side is split on the first `:` into model
 * and role. An empty segment (bare `@`, leading `:`) yields an empty string so callers reject
 * it as unresolvable. Team tags are not slugified here — the caller slugifies to match roles.
 */
export const parseSelector = (selector: string): Selector => {
   const
      [base, team] = selector.split('@', 2) as [string, string | undefined],
      [model, role] = base.split(':', 2) as [string, string | undefined]
   return { model, role, team }
}
