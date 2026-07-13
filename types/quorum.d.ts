/** Staggered-entry state for a run: which seats have entered and the team-ordered bench queue. */
interface Entry {
   entered: Set<number>
   queue: Speaker[]
   active: boolean
}

/** A quorum call's resolved config (preset defaults merged over per-call args), plus a first-fault `error` key and the `adHocEmpty` guard flag for the caller to check before staffing. */
interface QuorumConfig {
   preset: Preset | undefined
   effectiveRoles: RoleDef[]
   adHocEmpty: boolean
   rounds: number
   mode: QuorumMode
   synthSelector: string | undefined
   synthInterval: number
   frameSelector: string | undefined
   reframeEvery: SynthesizeEvery | undefined
   closing: boolean
   eliminateEvery: number | undefined
   enterEvery: number | undefined
   optional: boolean
   silentRoles: Set<string>
   error: 'closingWithoutSynth' | 'eliminateWithoutSynth' | undefined
}

/** Dependencies the neutral phases (frame, synthesis, elimination) borrow from the running quorum. */
interface PhaseDeps {
   synth: Speaker | undefined
   synthSelector: string | undefined
   frame: Speaker | undefined
   prompt: string
   labels: string[]
   optional: boolean
   templates: PromptTemplates
   errors: ErrorMessages
   live: Set<number>
   liveSpeakers: () => Speaker[]
   full: () => string | undefined
   telemetry: TurnTelemetry[]
   speakOne: TurnRunner['speakOne']
   record: TurnRunner['record']
   note: TurnRunner['note']
}

/** Dependencies the anonymous peer vote borrows from the running quorum. `seen` gives each voter its mode-appropriate context; `candidates` is the votable field (labels are the only ballot choices, so self-votes are structurally impossible). */
interface VoteDeps {
   args: QuorumInput
   preset: Preset | undefined
   rounds: number
   budgetOk: () => boolean
   liveSpeakers: () => Speaker[]
   candidates: () => Speaker[]
   labels: string[]
   seen: (s: Speaker, snapshot: QuorumTurn[]) => string | undefined
   runHidden: TurnRunner['runHidden']
   note: TurnRunner['note']
   telemetry: TurnTelemetry[]
   templates: PromptTemplates
}

/** A resolved quorum turn awaiting ordered recording: text plus its telemetry (contentIndex filled at record time). */
interface TurnOutcome {
   text: string | null
   entry: TurnTelemetry
}

/** A resolved council seat: a selector at its original position in `models[]`, plus its model def, optional role, and optional team. Duplicate selectors are distinct speakers with distinct indexes. */
interface Speaker {
   index: number
   selector: string
   def: ModelDef
   role?: string
   team?: string
   silent?: boolean
}

/** The resolved council: every seat, the round speakers (all but the synthesizer), the optional synthesizer, and per-seat display labels. `bad` names the first unresolvable selector instead. */
interface ResolvedCouncil {
   speakers: Speaker[]
   roundSpeakers: Speaker[]
   synth?: Speaker
   frame?: Speaker
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
   skip(round: number, from?: number, phase?: TurnPhase, list?: Speaker[]): void
   runParallel(list: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined, override?: (s: Speaker) => string | undefined): Promise<void>
   runHidden(list: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined, override?: (s: Speaker) => string | undefined): Promise<TurnOutcome[]>
}

/** Which phase of a run a turn belongs to: an opening/steering frame, a normal discussion round, a staggered entry note, a closing statement, an anonymous peer vote, a synthesis, or an elimination decision. */
type TurnPhase = 'frame' | 'round' | 'entry' | 'closing' | 'vote' | 'synthesis' | 'elimination'

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
