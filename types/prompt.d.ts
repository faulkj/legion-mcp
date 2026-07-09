/** Arguments accepted by every model tool. */
interface PromptInput {
   prompt: string
   context?: string
   role?: string
   system?: string
   temperature?: number
   maxTokens?: number
}

/** Token usage reported by the Responses API. */
interface TokenUsage {
   inputTokens?: number
   outputTokens?: number
   totalTokens?: number
   reasoningTokens?: number
}

/** Result of a single model call. */
interface PromptResult {
   text: string
   usage: TokenUsage
   latencyMs: number
   truncated?: boolean
   reasoningHeavy?: boolean
}

/** A resolved quorum turn awaiting ordered recording: text plus its telemetry (contentIndex filled at record time). */
interface TurnOutcome {
   text: string | null
   entry: TurnTelemetry
}

/** Stateful per-run turn engine: runs model calls and records outcomes/skips into shared collectors. */
interface TurnRunner {
   readonly telemetry: TurnTelemetry[]
   readonly turns: QuorumTurn[]
   readonly content: { type: 'text'; text: string }[]
   used(): number
   speakOne(selector: string, round: number, isSynthesis: boolean, extraContext?: string): Promise<TurnOutcome>
   record(outcome: TurnOutcome, round: number): void
   skip(round: number, from?: number): void
}

/** Arguments accepted by the quorum fan-out tool. */
interface QuorumInput extends PromptInput {
   models: string[]
   roles?: Record<string, string>
   rounds?: number
   mode?: 'sequential' | 'parallel'
   synthesize?: string
   tokenBudget?: number
   preset?: string
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
