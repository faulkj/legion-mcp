import { isEmptyResponse } from '../core/llm.js'
import { logPrompt, okStatus, promptEntry } from '../core/log.js'
import { banner } from './helpers.js'

/**
 * Build the stateful turn engine for one quorum run. Owns the telemetry/turns/content
 * collectors and the running token tally; `speakOne` calls a model, `record` commits an
 * outcome in council order (assigning contentIndex), and `skip` marks un-run turns.
 * `pending` holds public parallel turns that have finished but not yet committed, so a
 * live snapshot can show them without disturbing commit order. An aborted `signal` turns
 * every subsequent call into a `cancelled` outcome and `cancelled()` reports it.
 */
export const makeTurnRunner = (
   args: QuorumInput,
   effectiveRoles: RoleDef[],
   speakers: Speaker[],
   rounds: number,
   prompt: Prompt,
   templates: PromptTemplates,
   signal?: AbortSignal,
   runId = Math.random().toString(36).slice(2, 8)
): TurnRunner => {
   const
      telemetry: TurnTelemetry[] = [],
      turns: QuorumTurn[] = [],
      content: { type: 'text'; text: string }[] = [],
      pending: QuorumTurn[] = [],
      inFlight: InFlightSeat[] = []
   let
      used = 0,
      phase = 'starting'

   const skip = (round: number, from = 0, phase: TurnPhase = 'round', list: Speaker[] = speakers, reason = 'budget'): void =>
      list.slice(from).forEach(s =>
         telemetry.push({ index: s.index, selector: s.selector, modelName: s.def.name, modelId: s.def.model, role: s.role, round, phase, usage: {}, latencyMs: 0, status: `skipped: ${reason}` }))

   const record = ({ text, entry, cancelled }: TurnOutcome, round: number): void => {
      if (text !== null) {
         entry.contentIndex = content.length
         content.push({ type: 'text', text })
         turns.push({
            index: entry.index, selector: entry.selector, round, phase: entry.phase, text,
            ...(entry.status.includes('truncated') ? { truncated: true } : {}),
            ...(entry.status.includes('degenerate') ? { degenerate: true } : {})
         })
      } else if (!cancelled)
         turns.push({ index: entry.index, selector: entry.selector, round, phase: entry.phase, text: '', failed: failReason(entry.status) })
      telemetry.push(entry)
   }

   const note = (turn: QuorumTurn, entry: TurnTelemetry): void => {
      turns.push(turn)
      telemetry.push(entry)
   }

   const speakOne = async (speaker: Speaker, round: number, phase: TurnPhase, extraContext?: string, promptOverride?: string): Promise<TurnOutcome> => {
      const
         { index, selector, def, role } = speaker,
         base = { index, selector, modelName: def.name, modelId: def.model, role, round, phase },
         roleInput: PromptInput = {
            prompt: promptOverride ?? banner(round, rounds, phase, templates) + args.prompt,
            system: args.system,
            temperature: args.temperature,
            maxTokens: args.maxTokens ?? speaker.maxTokens,
            role,
            context: extraContext ?? args.context
         },
         started = performance.now()
      if (signal?.aborted)
         return { text: null, cancelled: true, entry: { ...base, usage: {}, latencyMs: 0, status: 'cancelled' } }
      const seat: InFlightSeat = { index, selector, round, phase, startedAt: Date.now() }
      inFlight.push(seat)
      try {
         const result = await prompt(def, roleInput, effectiveRoles, templates, signal)
         used += result.usage.totalTokens ?? 0
         // A vote ballot is secret: never log its text (debug logs would otherwise reconstruct who voted for what by selector).
         logPrompt(promptEntry(def, roleInput, { response: phase === 'vote' ? '(anonymous ballot — redacted)' : result.text, usage: result.usage, latencyMs: result.latencyMs }, selector, runId))
         return { text: result.text, entry: { ...base, usage: result.usage, latencyMs: result.latencyMs, status: okStatus(result) } }
      } catch (err) {
         const
            latencyMs = Math.round(performance.now() - started),
            cancelled = signal?.aborted === true,
            message = cancelled ? 'cancelled' : err instanceof Error ? err.message : String(err),
            usage = (err as { usage?: TokenUsage })?.usage ?? {}
         used += usage.totalTokens ?? 0
         logPrompt(promptEntry(def, roleInput, { error: message, latencyMs, usage }, selector, runId))
         return { text: null, cancelled, entry: { ...base, usage, latencyMs, status: cancelled ? 'cancelled' : `error: ${message}` } }
      } finally {
         const i = inFlight.indexOf(seat)
         i >= 0 && inFlight.splice(i, 1)
      }
   }

   const launch = (list: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined, override?: (s: Speaker) => string | undefined): Promise<TurnOutcome>[] =>
      list.map(s => {
         try { return speakOne(s, round, phase, ctx(s), override?.(s)) }
         catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return Promise.resolve({ text: null, entry: { index: s.index, selector: s.selector, modelName: s.def.name, modelId: s.def.model, role: s.role, round, phase, usage: {}, latencyMs: 0, status: `error: ${message}` } })
         }
      })

   const runParallel = async (list: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined, override?: (s: Speaker) => string | undefined): Promise<void> => {
      const outcomes = await Promise.all(launch(list, round, phase, ctx, override).map(p =>
         p.then(o => (o.text !== null && pending.push({ index: o.entry.index, selector: o.entry.selector, round, phase, text: o.text }), o))))
      pending.length = 0
      for (const outcome of outcomes) record(outcome, round)
   }

   const runHidden = (list: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined, override?: (s: Speaker) => string | undefined): Promise<TurnOutcome[]> =>
      Promise.all(launch(list, round, phase, ctx, override))

   return {
      telemetry, turns, content, pending, inFlight,
      used: () => used,
      cancelled: () => signal?.aborted === true,
      phase: () => phase,
      setPhase: (p: string) => { phase = p },
      speakOne, record, note, skip, runParallel, runHidden
   }
}

const failReason = (status: string): 'timeout' | 'empty' | 'error' =>
   /timed out/i.test(status) ? 'timeout' : isEmptyResponse(status.replace(/^error: /, '')) ? 'empty' : 'error'
