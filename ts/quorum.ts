import { fill, slugify } from './config.js'
import { createPrompt } from './llm.js'
import { log, logPrompt, okStatus, promptEntry } from './log.js'
import { banner, dedup, resolve, toContext } from './quorumHelpers.js'

type Prompt = ReturnType<typeof createPrompt>

export const runQuorum = async (
   args: QuorumInput,
   models: ModelDef[],
   roles: RoleDef[],
   prompt: Prompt,
   maxRounds: number,
   dynamicRoles: boolean,
   templates: PromptTemplates,
   errors: ErrorMessages,
   tokenBudget?: number
): Promise<{ content: { type: 'text'; text: string }[]; structuredContent?: unknown; isError: boolean }> => {
   const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

   if (args.roles && Object.keys(args.roles).length && !dynamicRoles)
      return err(errors.adhocDisabled)

   const adHoc = Object.entries(args.roles ?? {}).map(([name, instructions]) => ({ name: slugify(name), instructions }))
   if (adHoc.some(r => !r.name))
      return err(errors.adhocEmptyName)

   const
      effectiveRoles = [...roles.filter(r => !adHoc.some(a => a.name === r.name)), ...adHoc],
      rounds = Math.min(maxRounds, Math.max(1, args.rounds ?? 1)),
      mode = args.mode ?? 'sequential',
      selectors = dedup(args.models),
      telemetry: TurnTelemetry[] = [],
      turns: QuorumTurn[] = [],
      content: { type: 'text'; text: string }[] = []

   const
      resolved = selectors.map(s => resolve(s, models, effectiveRoles)),
      badIndex = resolved.indexOf(null)
   if (badIndex !== -1)
      return err(fill(errors.unknownSelector, { selector: selectors[badIndex]! }))

   let used = 0

   const skip = (round: number) =>
      resolved.forEach((r, i) =>
         telemetry.push({ selector: selectors[i]!, modelName: r!.def.name, modelId: r!.def.model, role: r!.role, round, isSynthesis: false, usage: {}, latencyMs: 0, status: 'skipped: budget' }))

   const speakOne = async (selector: string, round: number, isSynthesis: boolean, extraContext?: string) => {
      const
         r = resolve(selector, models, effectiveRoles)!,
         roleInput: PromptInput = {
            prompt: banner(round, rounds, isSynthesis, templates) + args.prompt,
            system: args.system,
            temperature: args.temperature,
            maxTokens: args.maxTokens,
            role: r.role,
            context: extraContext ?? args.context
         },
         started = performance.now()
      try {
         const
            result = await prompt(r.def, roleInput, effectiveRoles, templates),
            ci = content.length
         used += result.usage.totalTokens ?? 0
         content.push({ type: 'text', text: result.text })
         logPrompt(promptEntry(r.def, roleInput, { response: result.text, usage: result.usage, latencyMs: result.latencyMs }, selector))
         telemetry.push({ selector, modelName: r.def.name, modelId: r.def.model, role: r.role, round, isSynthesis, usage: result.usage, latencyMs: result.latencyMs, status: okStatus(result), contentIndex: ci })
         return result.text
      } catch (err) {
         const
            message = err instanceof Error ? err.message : String(err),
            latencyMs = Math.round(performance.now() - started)
         logPrompt(promptEntry(r.def, roleInput, { error: message, latencyMs }, selector))
         telemetry.push({ selector, modelName: r.def.name, modelId: r.def.model, role: r.role, round, isSynthesis, usage: {}, latencyMs, status: `error: ${message}` })
         return null
      }
   }

   for (let round = 1; round <= rounds; round++) {
      if (tokenBudget && used >= tokenBudget) {
         for (let r = round; r <= rounds; r++) skip(r)
         log('warn', `⚠️ token budget ${tokenBudget} exceeded (${used}) — skipping remaining turns`)
         break
      }
      if (mode === 'sequential') {
         for (const selector of selectors) {
            const
               ctx = toContext(turns, templates, args.context),
               text = await speakOne(selector, round, false, ctx)
            text !== null && turns.push({ selector, round, text })
         }
      } else {
         const
            prevCtx = toContext(turns, templates, args.context),
            results = await Promise.allSettled(selectors.map(s => speakOne(s, round, false, prevCtx)))
         results.forEach((r, i) => {
            r.status === 'fulfilled' && r.value !== null && turns.push({ selector: selectors[i]!, round, text: r.value })
         })
      }
   }

   if (args.synthesize !== undefined) {
      const synthResolved = resolve(args.synthesize, models, effectiveRoles)
      if (!synthResolved)
         telemetry.push({ selector: args.synthesize, modelName: '', modelId: '', round: 0, isSynthesis: true, usage: {}, latencyMs: 0, status: errors.unresolvableSelector })
      else {
         const synthText = await speakOne(args.synthesize, 0, true, toContext(turns, templates, args.context))
         synthText !== null && turns.push({ selector: args.synthesize, round: 0, text: synthText })
         const synthTurn = telemetry[telemetry.length - 1]
         synthTurn?.status.includes('reasoning-heavy') &&
            log('warn', `⚠️ synthesis (${args.synthesize}) spent most of its budget reasoning — raise maxTokens or use a lighter model for synthesize`)
      }
   }

   return {
      content,
      structuredContent: {
         turns: telemetry,
         transcript: toContext(turns, templates) ?? '',
         ...(tokenBudget ? { budget: { limit: tokenBudget, used, exceeded: used > tokenBudget } } : {})
      },
      isError: content.length === 0
   }
}
