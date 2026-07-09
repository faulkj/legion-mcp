import { loadModels } from '../config/config.js'
import { createPrompt, emptyOutputError } from './llm.js'

/**
 * Deep health probe: fan a minimal prompt to every configured model and report
 * per-model reachability. Re-scans the models directory so results reflect the
 * live config, not a boot snapshot. `status` is `degraded` if any model fails.
 */
export const makeProbe = (config: AppConfig): () => Promise<HealthReport> => {
   const prompt = createPrompt(config)

   return async () => {
      const models = await Promise.all(loadModels(config).map(async def => {
         const started = performance.now()
         try {
            // Reachability only: a minimal (but API-valid) budget. Hitting the
            // token ceiling still proves the endpoint answered, so llm.ts's
            // empty-output error is treated as reachable below, not a failure.
            await prompt(def, { prompt: 'ping', maxTokens: probeTokens })
            return { name: def.name, model: def.model, ok: true, latencyMs: Math.round(performance.now() - started) }
         } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            return message.startsWith(emptyOutputError)
               ? { name: def.name, model: def.model, ok: true, latencyMs: Math.round(performance.now() - started) }
               : { name: def.name, model: def.model, ok: false, latencyMs: Math.round(performance.now() - started), error: message }
         }
      }))
      return { status: models.every(m => m.ok) ? 'ok' : 'degraded', name: config.name, version: config.version, models }
   }
}

// Smallest budget the Responses API accepts; we only care that the endpoint answers.
const probeTokens = 16
