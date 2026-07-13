import { slugify } from '../config/config.js'
import { everyN } from './context.js'
import { mergePresetRoles, presetFrame, presetSynth } from './helpers.js'

/**
 * Resolve a quorum call's effective configuration from its args and (optional) preset: merged
 * roles, round count, mode, the synth/frame selectors and their cadences, the elimination/entry
 * knobs, and the silent-role set. A preset's authoritative values win over per-call args. Also
 * surfaces two pre-staffing guards for the caller to check: `adHocEmpty` (an ad-hoc role with a
 * blank name) and `error` (the first synthesizer-dependency violation — closing/eliminate with
 * no synthesizer), both keyed to `ErrorMessages` so the caller can bail before staffing.
 */
export const resolveConfig = (args: QuorumInput, models: ModelDef[], roles: RoleDef[], presets: Presets, maxRounds: number): QuorumConfig => {
   const
      adHoc = Object.entries(args.roles ?? {}).map(([name, instructions]) => ({ name: slugify(name), instructions })),
      preset = args.preset === undefined ? undefined : presets[args.preset],
      baseRoles = [...roles.filter(r => !adHoc.some(a => a.name === r.name)), ...adHoc],
      effectiveRoles = preset ? mergePresetRoles(baseRoles, preset) : baseRoles,
      synthSelector = preset ? presetSynth(preset, args.models, models, effectiveRoles) : args.synthesize,
      closing = (preset?.closingStatements ?? args.closingStatements) === true,
      eliminateEvery = preset?.eliminateEvery
   return {
      preset,
      effectiveRoles,
      adHocEmpty: adHoc.some(r => !r.name),
      rounds: Math.min(maxRounds, Math.max(1, args.rounds ?? preset?.defaultRounds ?? 1)),
      mode: preset?.mode ?? args.mode ?? 'sequential',
      synthSelector,
      synthInterval: synthSelector === undefined ? Infinity : everyN(preset?.synthesizeEvery ?? args.synthesizeEvery),
      frameSelector: preset ? presetFrame(preset, args.models, models, effectiveRoles) : args.frame,
      reframeEvery: preset?.reframeEvery ?? args.reframeEvery,
      closing,
      eliminateEvery,
      enterEvery: preset?.enterEvery,
      optional: preset?.eliminationsOptional === true,
      silentRoles: new Set((preset?.roles ?? []).filter(r => r.silent).map(r => slugify(r.role))),
      error: closing && synthSelector === undefined ? 'closingWithoutSynth'
         : eliminateEvery !== undefined && eliminateEvery > 0 && synthSelector === undefined ? 'eliminateWithoutSynth'
            : undefined
   }
}
