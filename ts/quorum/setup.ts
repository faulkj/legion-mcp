import { fill, slugify } from '../config/config.js'
import { everyN } from './context.js'
import { objectiveError } from './entry.js'
import { resolveSpeakers } from './helpers.js'
import { mergePresetRoles, presetFrame, presetSynth } from './preset.js'

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
      eliminateEvery = preset?.eliminateEvery,
      rounds = Math.min(maxRounds, Math.max(1, args.rounds ?? preset?.defaultRounds ?? 1))
   return {
      preset,
      effectiveRoles,
      adHocEmpty: adHoc.some(r => !r.name),
      rounds,
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
      // Clamped so a booked round always exists; the midpoint default lands the run-in mid-match rather than on the opening or closing bell.
      cameoRound: (preset?.roles ?? []).some(r => r.cameo)
         ? Math.min(rounds, Math.max(1, args.cameoRound ?? Math.ceil(rounds / 2)))
         : undefined,
      error: closing && synthSelector === undefined ? 'closingWithoutSynth'
         : eliminateEvery !== undefined && eliminateEvery > 0 && synthSelector === undefined ? 'eliminateWithoutSynth'
            : undefined
   }
}

/**
 * Staff the council from a resolved config and run every pre-round guard: unresolvable selectors,
 * teamed neutrals, `@team`-less candidates/tag-team seats when the preset needs sides, and the
 * team-objective contract. Returns the resolved council on success, or `{ error }` with a
 * ready-to-return message string on the first failure.
 */
export const staffCouncil = (args: QuorumInput, config: QuorumConfig, models: ModelDef[], errors: ErrorMessages): ResolvedCouncil & { error?: string } => {
   const
      { preset, effectiveRoles, synthSelector, frameSelector, silentRoles } = config,
      council = resolveSpeakers(args.models, synthSelector, models, effectiveRoles, frameSelector, silentRoles),
      { roundSpeakers, synth, frame, bad } = council,
      teamed = (predicate: (r: PresetRole) => boolean | undefined) =>
         roundSpeakers.find(s => s.team === undefined && preset?.roles.some(r => predicate(r) && slugify(r.role) === s.role)),
      unteamedCandidate = preset?.voteByTeam ? teamed(r => r.candidate) : undefined,
      unteamedTag = teamed(r => r.tagTeam),
      error = bad ? fill(errors.unknownSelector, { selector: bad })
         : synth?.team !== undefined ? errors.synthTeamed
            : frame?.team !== undefined ? errors.frameTeamed
               : unteamedCandidate ? `Selector "${unteamedCandidate.selector}" must use an @team tag for team voting.`
                  : unteamedTag ? `Selector "${unteamedTag.selector}" must use an @team tag for tag-team rounds.`
                     : objectiveError(roundSpeakers, args.objectives) ?? undefined
   return { ...council, error }
}
