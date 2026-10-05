/** A validated, staffed quorum call ready to run — no model has been called yet. */
interface PreparedQuorum {
   args: QuorumInput
   config: QuorumConfig
   council: ResolvedCouncil
}

/** The early-exit tool result a quorum call returns when validation or staffing fails. */
interface QuorumError {
   [key: string]: unknown
   content: { type: 'text'; text: string }[]
   isError: true
}

/** The completed tool result of a quorum run. `cancelled` is set in `structuredContent` when the run was aborted. */
interface QuorumResult {
   [key: string]: unknown
   content: { type: 'text'; text: string }[]
   structuredContent: {
      turns: TurnTelemetry[]
      timeline: TimelineEvent[]
      transcript: string
      preset?: string
      budget?: { limit: number; used: number; exceeded: boolean }
      cancelled?: true
   }
   isError: boolean
}

/** A resolved quorum turn awaiting ordered recording: text plus its telemetry (contentIndex filled at record time). `cancelled` marks a turn stopped by the run's abort signal rather than a model failure. */
interface TurnOutcome {
   text: string | null
   cancelled?: boolean
   entry: TurnTelemetry
}

/** A model call that has been launched and not yet settled, so a live snapshot can show who the run is waiting on. */
interface InFlightSeat {
   index: number
   selector: string
   round: number
   phase: TurnPhase
   startedAt: number
}

/** Stateful per-run turn engine: runs model calls and records outcomes/skips into shared collectors. `pending` holds finished-but-uncommitted public parallel turns; `inFlight` the calls still outstanding; `phase` is the human-readable step the run is on. */
interface TurnRunner {
   readonly telemetry: TurnTelemetry[]
   readonly turns: QuorumTurn[]
   readonly content: { type: 'text'; text: string }[]
   readonly pending: QuorumTurn[]
   readonly inFlight: InFlightSeat[]
   used(): number
   cancelled(): boolean
   phase(): string
   setPhase(phase: string): void
   speakOne(speaker: Speaker, round: number, phase: TurnPhase, extraContext?: string, promptOverride?: string): Promise<TurnOutcome>
   record(outcome: TurnOutcome, round: number): void
   note(turn: QuorumTurn, entry: TurnTelemetry): void
   skip(round: number, from?: number, phase?: TurnPhase, list?: Speaker[], reason?: string): void
   runParallel(list: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined, override?: (s: Speaker) => string | undefined): Promise<void>
   runHidden(list: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined, override?: (s: Speaker) => string | undefined): Promise<TurnOutcome[]>
}
