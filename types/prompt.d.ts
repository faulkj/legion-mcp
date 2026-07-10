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

/** A resolved council seat: a selector at its original position in `models[]`, plus its model def and optional role. Duplicate selectors are distinct speakers with distinct indexes. */
interface Speaker {
   index: number
   selector: string
   def: ModelDef
   role?: string
}

/** The resolved council: every seat, the round speakers (all but the synthesizer), the optional synthesizer, and per-seat display labels. `bad` names the first unresolvable selector instead. */
interface ResolvedCouncil {
   speakers: Speaker[]
   roundSpeakers: Speaker[]
   synth?: Speaker
   labels: string[]
   bad?: string
}

/** Stateful per-run turn engine: runs model calls and records outcomes/skips into shared collectors. */
interface TurnRunner {
   readonly telemetry: TurnTelemetry[]
   readonly turns: QuorumTurn[]
   readonly content: { type: 'text'; text: string }[]
   used(): number
   speakOne(speaker: Speaker, round: number, phase: TurnPhase, extraContext?: string, promptOverride?: string): Promise<TurnOutcome>
   record(outcome: TurnOutcome, round: number): void
   note(turn: QuorumTurn, entry: TurnTelemetry): void
   skip(round: number, from?: number, phase?: TurnPhase): void
}

/** Which phase of a run a turn belongs to: a normal discussion round, a closing statement, a synthesis, or an elimination decision. */
type TurnPhase = 'round' | 'closing' | 'synthesis' | 'elimination'

/** Visibility policy for a quorum run: how much of the transcript each round speaker sees. */
type QuorumMode = 'sequential' | 'parallel' | 'private' | 'independent'

/** When the synthesizer runs: `'end'` (once, after all rounds) or a number N (every Nth round, always including the last). */
type SynthesizeEvery = 'end' | number

/** Arguments accepted by the quorum fan-out tool. */
interface QuorumInput extends PromptInput {
   models: string[]
   roles?: Record<string, string>
   rounds?: number
   mode?: QuorumMode
   synthesize?: string
   synthesizeEvery?: SynthesizeEvery
   closingStatements?: boolean
   tokenBudget?: number
   preset?: string
}

/** Internal per-turn transcript entry for a quorum round. `index` is the speaker's stable identity (position in `models[]`). */
interface QuorumTurn {
   index: number
   selector: string
   round: number
   phase: TurnPhase
   text: string
}

/** Per-turn telemetry emitted in quorum structuredContent. */
interface TurnTelemetry {
   index: number
   selector: string
   modelName: string
   modelId: string
   role?: string
   round: number
   phase: TurnPhase
   usage: TokenUsage
   latencyMs: number
   status: string
   contentIndex?: number
   eliminatedIndex?: number
}
