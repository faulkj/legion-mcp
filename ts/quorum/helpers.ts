import { fill, slugify } from '../config/config.js'
import { makeTurnLabels } from './context.js'
import { parseSelector } from './selectors.js'

/** Resolve a `model[:role][@team]` selector to its model def, optional role, and optional (slugified) team; null when the model or role is unknown. */
export const resolve = (selector: string, models: ModelDef[], roles: RoleDef[]): { def: ModelDef; role?: string; team?: string } | null => {
   const
      { model, role, team } = parseSelector(selector),
      def = models.find(m => slugify(m.name) === model)
   if (!def) return null
   if (role !== undefined && !roles.find(r => r.name === role)) return null
   if (team !== undefined && !team) return null
   return { def, role, team: team === undefined ? undefined : slugify(team) }
}

/**
 * Resolve `selectors` into council seats (one Speaker each, keeping order and duplicates —
 * position is the stable identity). Neutral voices (synthesizer, framer) never speak in normal
 * rounds: an in-list neutral fills its slot from the FIRST match, an external one appends a seat.
 * A seat whose role is in `silentRoles` is flagged `silent` (it hears everything and votes, but
 * takes no round/elimination turn — e.g. an electorate). Returns `{ bad }` for the first unknown selector.
 */
export const resolveSpeakers = (selectors: string[], synthSelector: string | undefined, models: ModelDef[], roles: RoleDef[], frameSelector?: string, silentRoles?: Set<string>): ResolvedCouncil => {
   const seats = selectors.map((selector, index) => ({ selector, index, r: resolve(selector, models, roles) }))
   for (const s of seats)
      if (s.r === null) return { speakers: [], roundSpeakers: [], labels: [], bad: s.selector }
   const
      speakers: Speaker[] = seats.map(({ selector, index, r }) => ({ index, selector, def: r!.def, role: r!.role, team: r!.team, silent: r!.role !== undefined && silentRoles?.has(r!.role) })),
      // Resolve a neutral (synth/frame): reuse an in-list seat, else append past the list at `at`.
      pick = (sel: string | undefined, at: number): Speaker | undefined => {
         if (sel === undefined) return undefined
         const ext = resolve(sel, models, roles)
         return speakers.find(s => s.selector === sel) ?? (ext ? { index: at, selector: sel, def: ext.def, role: ext.role, team: ext.team } : undefined)
      },
      synth = pick(synthSelector, speakers.length),
      frame = pick(frameSelector, synth && synth.index >= speakers.length ? speakers.length + 1 : speakers.length),
      neutral = new Set([synth?.index, frame?.index].filter(i => i !== undefined)),
      roundSpeakers = speakers.filter(s => !neutral.has(s.index)),
      extras = [synth, frame].filter((s): s is Speaker => s !== undefined && s.index >= speakers.length),
      labels = makeTurnLabels([...speakers, ...extras])
   return { speakers, roundSpeakers, synth, frame, labels }
}

/** Banner prepended to a turn's prompt, chosen by phase: closing statements, eliminations, and syntheses (interim for round > 0, final for round 0) get their own banner; a normal round gets the exploring/final banner, or nothing for a lone round. */
export const banner = (round: number, rounds: number, phase: TurnPhase, t: PromptTemplates): string =>
   phase === 'closing'
      ? t.closingStatement
      : phase === 'elimination'
         ? t.elimination
         : phase === 'synthesis'
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
      // Skip unknown models here; the generic unknown-selector check reports those with a clearer message.
      if (modelKnown && (role === undefined || !roleSlugs.includes(slugify(role)))) return { kind: 'roleNotInPreset', selector }
   }
   // Count speakers per role — duplicate selectors are distinct speakers and each counts; enforce each role's [min, max].
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
