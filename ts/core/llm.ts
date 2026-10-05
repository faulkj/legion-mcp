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
         // maxRetries is pinned because the SDK retries timeouts too: the default (2) would make one stalled seat cost 3 × timeout.
         !clients.has(key) && clients.set(key, new OpenAI({ baseURL: url, apiKey, timeout: config.modelTimeout, maxRetries: 1 }))
         return clients.get(key)!
      }

   const attempt = async (def: ModelDef, input: PromptInput, roles: RoleDef[], templates: PromptTemplates, signal?: AbortSignal) => {
      const
         started = performance.now(),
         params = {
            model: def.model,
            input: composeInput(input, templates),
            store: false,
            max_output_tokens: input.maxTokens ?? defaultMaxTokens,
            ...composeInstructions(def, input, roles, templates),
            ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
            ...(def.reasoning === undefined ? {} : { reasoning: { effort: def.reasoning } })
         }
      for (const key of def.omitParams ?? []) delete (params as Record<string, unknown>)[key]
      const res = await clientFor(def).responses.create(params, signal === undefined ? {} : { signal })
      return { res, text: res.output_text ?? '', started }
   }

   return async (def: ModelDef, input: PromptInput, roles: RoleDef[] = [], templates: PromptTemplates = loadPrompts(), signal?: AbortSignal): Promise<PromptResult> => {
      let { res, text, started } = await attempt(def, input, roles, templates, signal).catch(err => { throw withUsage(err) })
      if (res.status !== 'completed' && text === '' && !signal?.aborted)
         ({ res, text, started } = await attempt(def, input, roles, templates, signal).catch(err => { throw withUsage(err) }))

      if (res.status !== 'completed' && text === '')
         throw new Error(incompleteMessage(res.status, res.incomplete_details?.reason))

      const
         reasoningTokens = res.usage?.output_tokens_details?.reasoning_tokens,
         visibleTokens = (res.usage?.output_tokens ?? 0) - (reasoningTokens ?? 0),
         reasoningHeavy = !!reasoningTokens && reasoningTokens >= visibleTokens,
         degenerate = isDegenerate(text)
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
         ...(reasoningHeavy ? { reasoningHeavy: true } : {}),
         ...(degenerate ? { degenerate: true } : {})
      }
   }
}

const
   defaultMaxTokens = 8192,

   // A provider that rejects a response (content filter, policy) has still billed the call. The SDK keeps
   // only body.error, and gateways like LiteLLM embed the upstream JSON in the message, so look in both
   // places and hang the usage on the thrown error for the caller to book.
   withUsage = (err: unknown): unknown => {
      if (!(err instanceof Error)) return err
      const
         fromBody = (err as { error?: { usage?: Record<string, number> } }).error?.usage,
         fromText = err.message.match(/"usage"\s*:\s*(\{[^{}]*\})/)?.[1],
         u = fromBody ?? (fromText ? (() => { try { return JSON.parse(fromText) as Record<string, number> } catch { return undefined } })() : undefined)
      if (u)
         (err as Error & { usage?: TokenUsage }).usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens }
      return err
   },

   // A model stuck in a loop emits a long tail of the same few words. Legit prose keeps well over
   // half its words unique; a collapsed tail sits near 5%. Only the tail is checked so a long,
   // healthy answer that ends in a short list is not flagged.
   isDegenerate = (text: string): boolean => {
      const words = text.slice(-600).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      return words.length >= 60 && new Set(words).size / words.length < 0.2
   },

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
