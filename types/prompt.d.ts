/** The bound per-run prompt function returned by `createPrompt`. */
type Prompt = ReturnType<typeof import('../ts/core/llm.js').createPrompt>

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

/** Parsed parts of a council selector: `model`, `model:role`, `model@team`, or `model:role@team`. */
interface Selector {
   model: string
   role?: string
   team?: string
}

/** Visibility policy for a quorum run: how much of the transcript each round speaker sees. */
type QuorumMode = 'sequential' | 'parallel' | 'private' | 'independent'

/** When the synthesizer runs: `'end'` (once, after all rounds) or a number N (every Nth round, always including the last). */
type SynthesizeEvery = 'end' | number

/** How much of an anonymous peer vote is revealed: `aggregate` shows only counts; `ballots` also shows the anonymized ballot texts (never voter identities). */
type VoteVisibility = 'aggregate' | 'ballots'

/** Arguments accepted by the quorum fan-out tool. */
interface QuorumInput extends PromptInput {
   models: string[]
   roles?: Record<string, string>
   rounds?: number
   mode?: QuorumMode
   synthesize?: string
   synthesizeEvery?: SynthesizeEvery
   frame?: string
   reframeEvery?: SynthesizeEvery
   closingStatements?: boolean
   objectives?: Record<string, string>
   vote?: string
   voteEvery?: SynthesizeEvery
   voteVisibility?: VoteVisibility
   allowSelfVote?: boolean
   tokenBudget?: number
   preset?: string
}
