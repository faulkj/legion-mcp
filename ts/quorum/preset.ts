import { fill, slugify } from '../config/config.js'
import { parseSelector } from './selectors.js'
import { resolve } from './helpers.js'

/** Turn a preset's inline roles into RoleDefs, using each role's description as its instructions (slug-keyed). */
export const presetRoles = (preset: Preset): RoleDef[] =>
   preset.roles
      .filter(r => r.description !== undefined)
      .map(r => ({ name: slugify(r.role), instructions: Array.isArray(r.description) ? r.description.join('\n') : r.description! }))

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

/** The `models[]` selector whose role matches a preset's framer role, or undefined if unstaffed (framer is optional). */
export const presetFrame = (preset: Preset, selectors: string[], models: ModelDef[], roles: RoleDef[]): string | undefined =>
   preset.frame === undefined
      ? undefined
      : selectors.find(s => resolve(s, models, roles)?.role === slugify(preset.frame!))

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
         { model, role } = parseSelector(selector),
         modelKnown = models.some(m => slugify(m.name) === model)
      // Unknown models fall through to the generic unknown-selector check, which reports them more clearly.
      if (modelKnown && (role === undefined || !roleSlugs.includes(slugify(role)))) return { kind: 'roleNotInPreset', selector }
   }
   for (const r of preset.roles) {
      const
         slug = slugify(r.role),
         count = selectors.filter(s => slugify(parseSelector(s).role ?? '') === slug).length,
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
