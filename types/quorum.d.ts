/** Staggered-entry state for a run: which seats have entered and the team-ordered bench queue. */
interface Entry {
   entered: Set<number>
   queue: Speaker[]
   active: boolean
}

/** The run's live field selectors, derived from entry/elimination state and preset role marks. `tagTeamRoles` feeds `rotateTeams`; the rest slice the field for each phase (cameos excluded from every recurring phase). */
interface Field {
   tagTeamRoles: Set<string>
   onCard: (list: Speaker[], round: number) => Speaker[]
   field: () => Speaker[]
   regulars: () => Speaker[]
   voters: () => Speaker[]
   liveSpeakers: () => Speaker[]
   candidates: () => Speaker[]
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
   eliminateEvery: EliminateEvery | undefined
   enterEvery: number | undefined
   optional: boolean
   silentRoles: Set<string>
   roleTokens: Map<string, number>
   cameoRound: number | undefined
   error: 'closingWithoutSynth' | 'eliminateWithoutSynth' | undefined
}

/** Dependencies the anonymous peer vote borrows from the running quorum. `seen` gives each voter its mode-appropriate context; `candidates` is the votable field (labels are the only ballot choices, so self-votes are structurally impossible). */
interface VoteDeps {
   args: QuorumInput
   preset: Preset | undefined
   rounds: number
   budgetOk: () => boolean
   liveSpeakers: () => Speaker[]
   candidates: () => Speaker[]
   voteByTeam: boolean
   labels: string[]
   seen: (s: Speaker, snapshot: QuorumTurn[]) => string | undefined
   runHidden: TurnRunner['runHidden']
   note: TurnRunner['note']
   telemetry: TurnTelemetry[]
   templates: PromptTemplates
}

/** A resolved council seat: a selector at its original position in `models[]`, plus its model def, optional role, and optional team. Duplicate selectors are distinct speakers with distinct indexes. */
interface Speaker {
   index: number
   selector: string
   def: ModelDef
   role?: string
   team?: string
   silent?: boolean
   maxTokens?: number
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

/** Which phase of a run a turn belongs to: framing, discussion, entry, closing, voting, synthesis, or elimination. */
type TurnPhase = 'frame' | 'round' | 'entry' | 'closing' | 'vote' | 'synthesis' | 'elimination'

/** Internal per-turn transcript entry for a quorum round. `index` is the speaker's stable identity (position in `models[]`). `truncated` marks a turn the provider confirmed hit maxTokens; `incomplete` marks any other non-completed status, so the transcript can flag each to every later reader. */
interface QuorumTurn {
   index: number
   selector: string
   round: number
   phase: TurnPhase
   text: string
   truncated?: boolean
   incomplete?: boolean
   /** The answer collapsed into a repetition loop; the transcript shows only its head plus a marker. */
   degenerate?: boolean
   /** Set when the seat produced no text: the transcript renders a reason instead of silence. */
   failed?: 'timeout' | 'empty' | 'error'
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

/** One ordered event in the run's flattened timeline. `who` is absent for seatless notes (votes, unresolvable synthesis); `detail` carries the vote tally, elimination target, or a skip/error status. */
interface TimelineEvent {
   round: number
   phase: TurnPhase
   who?: string
   detail?: string
}
