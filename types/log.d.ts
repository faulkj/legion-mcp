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
