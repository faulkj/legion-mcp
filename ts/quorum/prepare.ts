import { presetError, validatePreset } from './preset.js'
import { resolveConfig, staffCouncil } from './setup.js'

/**
 * Validate a quorum call and staff its council without making any model call. Returns the
 * existing `isError` tool result on the first failure, else the resolved config and council
 * ready for `runQuorum`. Async start uses this to reject bad requests inline rather than
 * admitting a job that would fail on its first poll.
 */
export const prepareQuorum = (
   args: QuorumInput,
   models: ModelDef[],
   roles: RoleDef[],
   maxRounds: number,
   dynamicRoles: boolean,
   errors: ErrorMessages,
   presets: Presets = {}
): PreparedQuorum | QuorumError => {
   const err = (text: string): QuorumError => ({ content: [{ type: 'text', text }], isError: true })

   if (args.roles && Object.keys(args.roles).length && !dynamicRoles)
      return err(errors.adhocDisabled)

   const config = resolveConfig(args, models, roles, presets, maxRounds)
   if (config.adHocEmpty) return err(errors.adhocEmptyName)
   if (config.error) return err(errors[config.error])

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, args.models, presets, models, roles), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   const { error, ...council } = staffCouncil(args, config, models, errors)
   return error ? err(error) : { args, config, council }
}

/** Whether a `prepareQuorum` result is the early error form. */
export const isQuorumError = (p: PreparedQuorum | QuorumError): p is QuorumError => 'isError' in p
