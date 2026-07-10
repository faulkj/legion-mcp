import { createPrompt } from '../core/llm.js'
import { logPrompt, okStatus, promptEntry } from '../core/log.js'
import { banner } from './helpers.js'

type Prompt = ReturnType<typeof createPrompt>

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

   const skip = (round: number, from = 0): void =>
      speakers.slice(from).forEach(s =>
         telemetry.push({ index: s.index, selector: s.selector, modelName: s.def.name, modelId: s.def.model, role: s.role, round, isSynthesis: false, usage: {}, latencyMs: 0, status: 'skipped: budget' }))

   const record = ({ text, entry }: TurnOutcome, round: number): void => {
      if (text !== null) {
         entry.contentIndex = content.length
         content.push({ type: 'text', text })
         turns.push({ index: entry.index, selector: entry.selector, round, text })
      }
      telemetry.push(entry)
   }

   const speakOne = async (speaker: Speaker, round: number, isSynthesis: boolean, extraContext?: string): Promise<TurnOutcome> => {
      const
         { index, selector, def, role } = speaker,
         base = { index, selector, modelName: def.name, modelId: def.model, role, round, isSynthesis },
         roleInput: PromptInput = {
            prompt: banner(round, rounds, isSynthesis, templates) + args.prompt,
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

   return { telemetry, turns, content, used: () => used, speakOne, record, skip }
}
