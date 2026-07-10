import { fill, slugify } from '../config/config.js'

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

/** Round/synthesis banner prepended to a turn's prompt; empty for a single non-synthesis round. A per-round synthesis (round > 0) gets the interim banner, the final synthesis (round 0) the final one. */
export const banner = (round: number, rounds: number, isSynthesis: boolean, t: PromptTemplates): string =>
   isSynthesis
      ? round === 0 ? t.synthesis : t.roundSynthesis
      : rounds < 2
         ? ''
         : fill(round < rounds ? t.roundExploring : t.roundFinal, { round, rounds })

/** Turn a preset's inline roles into RoleDefs, using each role's description as its instructions (slug-keyed). */
export const presetRoles = (preset: Preset): RoleDef[] =>
   preset.roles
      .filter(r => r.description !== undefined)
      .map(r => ({ name: slugify(r.role), instructions: r.description! }))

/** Merge a preset's inline roles over a base role list (preset roles win on slug collision). */
export const mergePresetRoles = (base: RoleDef[], preset: Preset): RoleDef[] => {
   const inline = presetRoles(preset)
   return [...base.filter(b => !inline.some(i => i.name === b.name)), ...inline]
}

/** The `models[]` selector whose role matches a preset's synthesize role, or undefined if unstaffed. */
export const presetSynth = (preset: Preset, selectors: string[], models: ModelDef[], roles: RoleDef[]): string | undefined =>
   preset.synthesize === undefined
      ? undefined
      : selectors.find(s => resolve(s, models, roles)?.role === slugify(preset.synthesize!))

/** Validate a quorum call's selectors against a chosen preset; `ok` when every role is staffed within its cardinality. */
export const validatePreset = (
   presetName: string,
   selectors: string[],
   presets: Presets,
   models: ModelDef[],
   fileRoles: RoleDef[]
): PresetValidationResult => {
   const preset = presets[presetName]
   if (!preset) return { kind: 'unknownPreset' }
   const roleSlugs = preset.roles.map(r => slugify(r.role))
   for (const r of preset.roles) {
      const slug = slugify(r.role)
      if (r.description === undefined && !fileRoles.find(f => f.name === slug)) return { kind: 'presetRoleMissingFile', role: slug }
   }
   for (const selector of selectors) {
      const
         [modelPart, rolePart] = selector.split(':', 2),
         modelKnown = models.some(m => slugify(m.name) === modelPart)
      // Skip unknown models here; the generic unknown-selector check reports those with a clearer message.
      if (modelKnown && (rolePart === undefined || !roleSlugs.includes(slugify(rolePart)))) return { kind: 'roleNotInPreset', selector }
   }
   // Count effective speakers per role (selectors already deduped upstream); enforce each role's [min, max].
   for (const r of preset.roles) {
      const
         slug = slugify(r.role),
         count = selectors.filter(s => slugify(s.split(':', 2)[1] ?? '') === slug).length,
         min = r.min ?? 1,
         max = r.max === null ? Infinity : (r.max ?? 1)
      if (count < min) return { kind: 'presetRoleUnderStaffed', role: slug, min, count }
      if (count > max) return { kind: 'presetRoleOverStaffed', role: slug, max, count }
   }
   return { kind: 'ok' }
}

/** Map a preset validation result to a filled error message, or null when it passed. */
export const presetError = (result: PresetValidationResult, presetName: string, presets: Presets, errors: ErrorMessages): string | null => {
   if (result.kind === 'ok') return null
   const tokens = {
      preset: presetName,
      available: result.kind === 'roleNotInPreset'
         ? (presets[presetName]?.roles ?? []).map(r => slugify(r.role)).join(', ')
         : Object.keys(presets).join(', ') || 'none',
      selector: 'selector' in result ? result.selector : '',
      role: 'role' in result ? result.role : '',
      min: 'min' in result ? result.min : '',
      max: 'max' in result ? result.max : '',
      count: 'count' in result ? result.count : ''
   }
   return fill(errors[result.kind], tokens)
}
