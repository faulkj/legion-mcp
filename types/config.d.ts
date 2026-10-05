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
   description?: string | string[]
   min?: number
   max?: number | null
   /** Per-seat output ceiling, overriding the call's `maxTokens`. Give reasoning synthesizers headroom: they can spend the whole budget thinking before emitting any text. */
   maxTokens?: number
   silent?: boolean
   voter?: boolean
   candidate?: boolean
   closing?: boolean
   closingLast?: boolean
   tagTeam?: boolean
   /** Speaks in exactly one round (the caller's `cameoRound`, else the midpoint) instead of every round — a run-in, not a regular. */
   cameo?: boolean
}

/** A named council recipe: roles to staff plus optional authoritative mode/synthesizer defaults. The config-facing `synthesizer` key maps to this internal `synthesize` field at load. */
interface Preset {
   description: string
   roles: PresetRole[]
   mode?: QuorumMode
   synthesize?: string
   synthesizeEvery?: SynthesizeEvery
   frame?: string
   reframeEvery?: SynthesizeEvery
   closingStatements?: boolean
   eliminateEvery?: number
   eliminationsOptional?: boolean
   enterEvery?: number
   vote?: string
   voteEvery?: SynthesizeEvery
   voteVisibility?: VoteVisibility
   allowSelfVote?: boolean
   voteByTeam?: boolean
   defaultRounds?: number
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

/** Everything the per-request server factory hot-reloads from disk. Kept as last-known-good in async mode. */
interface ReloadedConfig {
   description: string | undefined
   models: ModelDef[]
   roles: RoleDef[]
   schema: SchemaDescriptions
   templates: PromptTemplates
   errors: ErrorMessages
   presets: Presets
   prompt: Prompt
}

/** Validated, normalized application configuration. */
interface AppConfig {
   name: string
   version: string
   defaultBaseUrl?: string
   defaultApiKey?: string
   allowNoModels: boolean
   transport: 'http' | 'stdio'
   host: string
   allowedHosts?: string[]
   port: number
   maxRounds: number
   modelTimeout: number
   tokenBudget?: number
   dynamicRoles: boolean
   /** Bundled preset slugs to expose; `undefined` exposes them all. Local-only presets are always exposed. */
   presets?: string[]
   logLevel: LogLevel
   /** Council tools return a job handle and `poll`/`cancel` are exposed, instead of blocking until the run finishes. */
   asyncTools: boolean
   /** Trust Easy Auth principal headers for job ownership. Only safe behind an ingress that strips client-supplied copies. */
   trustProxyAuth: boolean
   jobLimits: JobLimits
}
