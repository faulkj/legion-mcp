import { fill, slugify } from './config.js'
import { createPrompt } from './llm.js'
import { log, logPrompt, okStatus, promptEntry } from './log.js'

type Prompt = ReturnType<typeof createPrompt>

export const runQuorum = async (
   args: QuorumInput,
   models: ModelDef[],
   roles: RoleDef[],
   prompt: Prompt,
   maxRounds: number,
   dynamicRoles: boolean,
   templates: PromptTemplates,
   errors: ErrorMessages
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

   return { content, structuredContent: { turns: telemetry, transcript: toContext(turns, templates) ?? '' }, isError: content.length === 0 }
}

const
   resolve = (selector: string, models: ModelDef[], roles: RoleDef[]): { def: ModelDef; role?: string } | null => {
      const
         [modelPart, rolePart] = selector.split(':', 2) as [string, string | undefined],
         def = models.find(m => slugify(m.name) === modelPart)
      if (!def) return null
      if (rolePart !== undefined && !roles.find(r => r.name === rolePart)) return null
      return { def, role: rolePart }
   },

   dedup = (selectors: string[]) => [...new Set(selectors)],

   banner = (round: number, rounds: number, isSynthesis: boolean, t: PromptTemplates): string =>
      isSynthesis
         ? t.synthesis
         : rounds < 2
            ? ''
            : fill(round < rounds ? t.roundExploring : t.roundFinal, { round, rounds }),

   toContext = (turns: QuorumTurn[], t: PromptTemplates, callerContext?: string): string | undefined => {
      if (!turns.length) return callerContext
      const
         transcript = turns.map(turn => `[round ${turn.round} / ${turn.selector}]\n${turn.text}`).join('\n\n'),
         block = fill(t.transcriptBlock, { transcript })
      return callerContext ? `${callerContext}\n\n${block}` : block
   }
