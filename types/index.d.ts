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

/** Overridable runtime error messages loaded from config/errors.json. Tokens in {braces} are filled at runtime. */
interface ErrorMessages {
   unknownRole: string
   unknownSelector: string
   adhocDisabled: string
   adhocEmptyName: string
   unresolvableSelector: string
   modelFailed: string
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
   defaultBaseUrl?: string
   defaultApiKey?: string
   host: string
   allowedHosts?: string[]
   port: number
   maxRounds: number
   dynamicRoles: boolean
   logLevel: LogLevel
}

/** Arguments accepted by every model tool. */
interface PromptInput {
   prompt: string
   context?: string
   role?: string
   system?: string
   temperature?: number
   maxTokens?: number
}

/** Internal per-turn transcript entry for a quorum round. */
interface QuorumTurn {
   selector: string
   round: number
   text: string
}

/** Per-turn telemetry emitted in quorum structuredContent. */
interface TurnTelemetry {
   selector: string
   modelName: string
   modelId: string
   role?: string
   round: number
   isSynthesis: boolean
   usage: TokenUsage
   latencyMs: number
   status: string
   contentIndex?: number
}

/** Token usage reported by the Responses API. */
interface TokenUsage {
   inputTokens?: number
   outputTokens?: number
   totalTokens?: number
   reasoningTokens?: number
}

/** Arguments accepted by the quorum fan-out tool. */
interface QuorumInput extends PromptInput {
   models: string[]
   roles?: Record<string, string>
   rounds?: number
   mode?: 'sequential' | 'parallel'
   synthesize?: string
}

/** Result of a single model call. */
interface PromptResult {
   text: string
   usage: TokenUsage
   latencyMs: number
   truncated?: boolean
   reasoningHeavy?: boolean
}

/** Severity levels, ordered from most to least verbose. */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** One model-call record — the shape a future DB/API sink would persist. */
interface PromptLogEntry {
   timestamp: string
   toolName: string
   modelName: string
   modelId: string
   params: {
      temperature?: number
      maxTokens?: number
      systemPresent: boolean
      contextPresent: boolean
      role?: string
   }
   usage: TokenUsage
   latencyMs: number
   prompt: string
   response: string
   error?: string
}

/** Pluggable logging destination. A DB/API sink can implement this later. */
interface LogSink {
   level(level: LogLevel, message: string, meta?: Record<string, unknown>): void
   prompt(entry: PromptLogEntry): void
}
