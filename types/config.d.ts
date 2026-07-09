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
   tokenBudget?: number
   dynamicRoles: boolean
   logLevel: LogLevel
}
