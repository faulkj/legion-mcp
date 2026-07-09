/** A single model exposed as a tool. */
interface ModelDef {
   name: string
   model: string
   description?: string
   baseUrl?: string
   apiKey?: string
   system?: string
   omitParams?: string[]
}

/** A hot-droppable role loaded from config/roles/<slug>.md. */
interface RoleDef {
   name: string
   instructions: string
}

/** Overridable schema field descriptions loaded from config/schema.json. */
type SchemaDescriptions = Record<string, string>

/**
 * One role slot in a preset. `description`, when present, IS the role's instructions;
 * otherwise a config/roles/<role>.md file must exist. Cardinality: `min` speakers required
 * (default 1), `max` speakers allowed (default 1; `null` = unbounded).
 */
interface PresetRole {
   role: string
   description?: string
   min?: number
   max?: number | null
}

/** A named council recipe: roles to staff plus optional authoritative mode/synthesizer defaults. The config-facing `synthesizer` key maps to this internal `synthesize` field at load. */
interface Preset {
   description: string
   roles: PresetRole[]
   mode?: 'sequential' | 'parallel'
   synthesize?: string
}

/** Named preset recipes loaded from config/presets/*.json (hot-reloaded per request). */
type Presets = Record<string, Preset>

/** Outcome of validating a quorum call's selectors against a chosen preset. */
type PresetValidationResult =
   | { kind: 'ok' }
   | { kind: 'unknownPreset' }
   | { kind: 'roleNotInPreset'; selector: string }
   | { kind: 'presetRoleUnderStaffed'; role: string; min: number; count: number }
   | { kind: 'presetRoleOverStaffed'; role: string; max: number; count: number }
   | { kind: 'presetRoleMissingFile'; role: string }
   | { kind: 'presetSynthUncovered'; role: string }

/** Overridable runtime error messages loaded from config/errors.json. Tokens in {braces} are filled at runtime. */
interface ErrorMessages {
   unknownRole: string
   unknownSelector: string
   adhocDisabled: string
   adhocEmptyName: string
   unresolvableSelector: string
   modelFailed: string
   unknownPreset: string
   roleNotInPreset: string
   presetRoleUnderStaffed: string
   presetRoleOverStaffed: string
   presetRoleMissingFile: string
   presetSynthUncovered: string
}

/** Overridable prompt-shaping templates loaded from config/prompts.json. Tokens in {braces} are filled at runtime. */
interface PromptTemplates {
   roleContract: string
   contextBlock: string
   transcriptBlock: string
   roundExploring: string
   roundFinal: string
   synthesis: string
}

/** Validated, normalized application configuration. */
interface AppConfig {
   name: string
   version: string
   modelsDir: string
   rolesDir: string
   toolsDir: string
   presetsDir: string
   defaultBaseUrl?: string
   defaultApiKey?: string
   host: string
   allowedHosts?: string[]
   port: number
   maxRounds: number
   tokenBudget?: number
   dynamicRoles: boolean
   logLevel: LogLevel
}
