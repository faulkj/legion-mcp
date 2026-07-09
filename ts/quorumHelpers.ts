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

/** Validate a quorum call's selectors against a chosen preset; `ok` when the council is well-staffed. */
export const validatePreset = (
   presetName: string,
   selectors: string[],
   presets: Presets,
   models: ModelDef[],
   fileRoles: RoleDef[],
   effectiveRoles: RoleDef[],
   adHocRoles: { name: string }[]
): PresetValidationResult => {
   const preset = presets[presetName]
   if (!preset) return { kind: 'unknownPreset' }
   const roleSlugs = preset.roles.map(r => slugify(r.role))
   for (const r of preset.roles) {
      const slug = slugify(r.role)
      if (r.description === undefined && !fileRoles.find(f => f.name === slug)) return { kind: 'presetRoleMissingFile', role: slug }
      if (r.description === undefined && adHocRoles.find(a => a.name === slug)) return { kind: 'presetRoleShadowed', role: slug }
   }
   for (const selector of selectors) {
      const r = resolve(selector, models, effectiveRoles)
      if (!r?.role || !roleSlugs.includes(r.role)) return { kind: 'roleNotInPreset', selector }
   }
   const uncovered = roleSlugs.find(role => !selectors.some(s => resolve(s, models, effectiveRoles)?.role === role))
   if (uncovered) return { kind: 'presetRoleUncovered', role: uncovered }
   const synth = preset.synthesize === undefined ? undefined : slugify(preset.synthesize)
   return synth && !selectors.some(s => resolve(s, models, effectiveRoles)?.role === synth)
      ? { kind: 'presetSynthUncovered', role: synth }
      : { kind: 'ok' }
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
      role: 'role' in result ? result.role : ''
   }
   return fill(errors[result.kind], tokens)
}
