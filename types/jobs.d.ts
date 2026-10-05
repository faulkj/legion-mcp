/** Lifecycle of a detached council run. `cancelling` = abort requested, launched calls still settling. `completed` may carry a result with `isError: true` (a tool error, not an execution failure). */
type JobState = 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'

/** Operating bounds for the in-memory job service, from env. */
interface JobLimits {
   retainMs: number
   maxActive: number
   maxRetained: number
   pollIntervalMs: number
   shutdownGraceMs: number
}

/** One tracked run. Runtime-only fields (`controller`, `runner`) never leave the process. */
interface Job {
   id: string
   tool: string
   owner: string | undefined
   state: JobState
   startedAt: number
   settledAt?: number
   controller: AbortController
   runner?: TurnRunner
   labels?: string[]
   result?: QuorumResult
   error?: string
}

/** A seat the run is currently waiting on, as shown to pollers. */
interface WaitingSeat {
   who: string
   phase: TurnPhase
   round: number
   elapsedMs: number
}

/** Copied public projection of a run in progress, from the live engine. */
interface RunSnapshot {
   phase: string
   answers: string[]
   notes: string[]
   turns: TurnTelemetry[]
   waitingOn: WaitingSeat[]
   usage: number
   transcript?: string
   timeline?: TimelineEvent[]
}

/** What poll/cancel/start return to the caller: identity, lifecycle, and the current public snapshot. `result` is the original council result once terminal. */
interface JobView {
   jobId: string
   tool: string
   state: JobState
   phase: string
   elapsedMs: number
   pollIntervalMs: number
   answers?: string[]
   notes?: string[]
   turns?: TurnTelemetry[]
   waitingOn?: WaitingSeat[]
   usage?: number
   transcript?: string
   timeline?: TimelineEvent[]
   expiresAt?: string
   result?: QuorumResult
   error?: string
}

/** A council run body: receives the job's abort signal and a hook that exposes the live engine for snapshots. */
type JobRun = (signal: AbortSignal, onRunner: (runner: TurnRunner, labels: string[]) => void, jobId: string) => Promise<QuorumResult>

/** Outcome of admitting a job. */
type JobStart = { kind: 'started'; view: JobView } | { kind: 'busy'; active: number; max: number }

/** The process-wide job service. */
interface JobService {
   start(tool: string, ctx: import('@modelcontextprotocol/server').ServerContext, run: JobRun): JobStart
   poll(id: string, ctx: import('@modelcontextprotocol/server').ServerContext, full: boolean): JobView | undefined
   cancel(id: string, ctx: import('@modelcontextprotocol/server').ServerContext): JobView | undefined
   counts(): { active: number; retained: number }
   shutdown(): Promise<void>
}

/** Shared dependencies for the council handler used by quorum and preset tools. `jobs` present = async mode. */
interface CouncilDeps {
   models: ModelDef[]
   roles: RoleDef[]
   prompt: Prompt
   config: AppConfig
   templates: PromptTemplates
   errors: ErrorMessages
   presets: Presets
   jobs?: JobService
}

/** Minimal tool-result shape the council handler returns in either mode. The index signature matches the SDK's CallToolResult. */
interface CallToolResultLike {
   [key: string]: unknown
   content: { type: 'text'; text: string }[]
   structuredContent?: unknown
   isError?: boolean
}
