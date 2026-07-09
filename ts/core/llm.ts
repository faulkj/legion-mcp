import OpenAI from 'openai'
import { fill, loadPrompts } from '../config/config.js'

/** Prefix of the error thrown when a model answers but emits no text before hitting maxTokens. */
export const emptyOutputError = 'no output before hitting maxTokens'

/** Build a `prompt` function that routes each model to its endpoint, falling back to the defaults. */
export const createPrompt = (config: AppConfig) => {
   const
      clients = new Map<string, OpenAI>(),
      clientFor = (def: ModelDef) => {
         const
            url = (def.baseUrl ?? config.defaultBaseUrl!).replace(/\/+$/, ''),
            apiKey = def.apiKey ?? config.defaultApiKey!,
            key = `${url}|${apiKey}`
         !clients.has(key) && clients.set(key, new OpenAI({ baseURL: url, apiKey }))
         return clients.get(key)!
      }

   const attempt = async (def: ModelDef, input: PromptInput, roles: RoleDef[], templates: PromptTemplates) => {
      const
         started = performance.now(),
         params = {
            model: def.model,
            input: composeInput(input, templates),
            store: false,
            max_output_tokens: input.maxTokens ?? defaultMaxTokens,
            ...composeInstructions(def, input, roles, templates),
            ...(input.temperature === undefined ? {} : { temperature: input.temperature })
         }
      for (const key of def.omitParams ?? []) delete (params as Record<string, unknown>)[key]
      const res = await clientFor(def).responses.create(params)
      return { res, text: res.output_text ?? '', started }
   }

   return async (def: ModelDef, input: PromptInput, roles: RoleDef[] = [], templates: PromptTemplates = loadPrompts()): Promise<PromptResult> => {
      let { res, text, started } = await attempt(def, input, roles, templates)
      if (res.status !== 'completed' && text === '')
         ({ res, text, started } = await attempt(def, input, roles, templates))

      if (res.status !== 'completed' && text === '')
         throw new Error(incompleteMessage(res.status, res.incomplete_details?.reason))

      const
         reasoningTokens = res.usage?.output_tokens_details?.reasoning_tokens,
         visibleTokens = (res.usage?.output_tokens ?? 0) - (reasoningTokens ?? 0),
         reasoningHeavy = !!reasoningTokens && reasoningTokens >= visibleTokens
      return {
         text,
         usage: {
            inputTokens: res.usage?.input_tokens,
            outputTokens: res.usage?.output_tokens,
            totalTokens: res.usage?.total_tokens,
            ...(reasoningTokens ? { reasoningTokens } : {})
         },
         latencyMs: Math.round(performance.now() - started),
         ...(res.status === 'completed' ? {} : { truncated: true }),
         ...(reasoningHeavy ? { reasoningHeavy: true } : {})
      }
   }
}

const
   defaultMaxTokens = 8192,

   incompleteMessage = (status?: string, reason?: string): string =>
      reason && reason !== 'max_output_tokens'
         ? `response ${status ?? 'incomplete'} (${reason})`
         : `${emptyOutputError} — raise maxTokens (reasoning models can spend the full budget thinking before emitting any text)`,

   composeInput = (input: PromptInput, t: PromptTemplates): string =>
      input.context === undefined
         ? input.prompt
         : fill(t.contextBlock, { prompt: input.prompt, context: input.context }),

   composeInstructions = (def: ModelDef, input: PromptInput, roles: RoleDef[], t: PromptTemplates): { instructions: string } | Record<string, never> => {
      const
         role = input.role === undefined ? undefined : roles.find(r => r.name === input.role),
         roleContract = role ? fill(t.roleContract, { role: role.name, instructions: role.instructions }) : undefined,
         parts = [def.system, input.system, roleContract].filter(Boolean) as string[]
      return parts.length ? { instructions: parts.join('\n\n') } : {}
   }
