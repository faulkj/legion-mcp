import { logPrompt, okStatus, promptEntry } from '../core/log.js'
import { banner } from './helpers.js'

/**
 * Build the stateful turn engine for one quorum run. Owns the telemetry/turns/content
 * collectors and the running token tally; `speakOne` calls a model, `record` commits an
 * outcome in council order (assigning contentIndex), and `skip` marks un-run turns.
 */
export const makeTurnRunner = (
   args: QuorumInput,
   effectiveRoles: RoleDef[],
   speakers: Speaker[],
   rounds: number,
   prompt: Prompt,
   templates: PromptTemplates
): TurnRunner => {
   const
      telemetry: TurnTelemetry[] = [],
      turns: QuorumTurn[] = [],
      content: { type: 'text'; text: string }[] = []
   let used = 0

   const skip = (round: number, from = 0, phase: TurnPhase = 'round', list: Speaker[] = speakers): void =>
      list.slice(from).forEach(s =>
         telemetry.push({ index: s.index, selector: s.selector, modelName: s.def.name, modelId: s.def.model, role: s.role, round, phase, usage: {}, latencyMs: 0, status: 'skipped: budget' }))

   const record = ({ text, entry }: TurnOutcome, round: number): void => {
      if (text !== null) {
         entry.contentIndex = content.length
         content.push({ type: 'text', text })
         turns.push({ index: entry.index, selector: entry.selector, round, phase: entry.phase, text })
      }
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
            maxTokens: args.maxTokens,
            role,
            context: extraContext ?? args.context
         },
         started = performance.now()
      try {
         const result = await prompt(def, roleInput, effectiveRoles, templates)
         used += result.usage.totalTokens ?? 0
         logPrompt(promptEntry(def, roleInput, { response: result.text, usage: result.usage, latencyMs: result.latencyMs }, selector))
         return { text: result.text, entry: { ...base, usage: result.usage, latencyMs: result.latencyMs, status: okStatus(result) } }
      } catch (err) {
         const
            message = err instanceof Error ? err.message : String(err),
            latencyMs = Math.round(performance.now() - started)
         logPrompt(promptEntry(def, roleInput, { error: message, latencyMs }, selector))
         return { text: null, entry: { ...base, usage: {}, latencyMs, status: `error: ${message}` } }
      }
   }

   const runParallel = async (list: Speaker[], round: number, phase: TurnPhase, ctx: (s: Speaker) => string | undefined, override?: (s: Speaker) => string | undefined): Promise<void> => {
      for (const outcome of await Promise.all(list.map(s => speakOne(s, round, phase, ctx(s), override?.(s)))))
         record(outcome, round)
   }

   return { telemetry, turns, content, used: () => used, speakOne, record, note, skip, runParallel }
}
