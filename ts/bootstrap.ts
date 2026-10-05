import { McpServer } from '@modelcontextprotocol/server'
import { loadConfig, loadDescription, loadErrors, loadModels, loadPrompts, loadRoles, loadSchema, loadToolDescription } from './config/config.js'
import { loadPresets } from './config/presets.js'
import { makeProbe } from './core/health.js'
import { createPrompt } from './core/llm.js'
import { log, setLogLevel } from './core/log.js'
import { makeJobService } from './jobs/jobs.js'
import { registerJobTools, registerModelTools, registerPresetTools, registerQuorumTool } from './tools/tools.js'

/** Load config, validate the models directory, and return a per-request server factory, a deep-health probe, and the job service (async mode only). */
export const bootstrap = (): { config: AppConfig; models: ModelDef[]; createServer: () => McpServer; probe: () => Promise<HealthReport>; jobs?: JobService } => {
   const
      config = loadConfig(),
      models = loadModels(config),
      jobs = config.asyncTools ? makeJobService(config, loadPrompts()) : undefined

   setLogLevel(config.logLevel)
   return { config, models, createServer: makeServerFactory(config, jobs), probe: makeProbe(config), jobs }
}

/**
 * Build a factory that re-scans the models directory per request — drop in a JSON, get a tool.
 * In async mode a reload failure falls back to the last good configuration so `poll`/`cancel`
 * for running jobs keep working; new councils then run against that stale config until fixed.
 */
export const makeServerFactory = (config: AppConfig, jobs?: JobService): () => McpServer => {
   const basePrompt = createPrompt(config)
   let lastGood: ReloadedConfig | undefined

   const reload = (): ReloadedConfig => {
      const
         roles = loadRoles(),
         templates = loadPrompts(),
         loaded: ReloadedConfig = {
            description: loadDescription(config.asyncTools),
            models: loadModels(config),
            roles,
            schema: loadSchema(),
            templates,
            errors: loadErrors(),
            presets: loadPresets(config),
            prompt: (def, input, override, tpl, signal) => basePrompt(def, input, override ?? roles, tpl ?? templates, signal)
         }
      return lastGood = loaded
   }

   return () => {
      const { description, models, roles, schema, templates, errors, presets, prompt } = (() => {
         try { return reload() }
         catch (e) {
            if (!jobs || !lastGood) throw e
            log('warn', `⚠️ config reload failed (${e instanceof Error ? e.message : String(e)}) — serving last good configuration so running jobs stay reachable`)
            return lastGood
         }
      })()
      const
         server = new McpServer(
            { name: config.name, version: config.version },
            description === undefined ? {} : { instructions: description }
         ),
         deps: CouncilDeps = { models, roles, prompt, config, templates, errors, presets, jobs }

      registerModelTools(server, models, roles, prompt, errors, schema, config.asyncTools)
      registerQuorumTool(server, deps, loadToolDescription('quorum'), schema)
      registerPresetTools(server, deps, schema)
      jobs && registerJobTools(server, jobs, errors, { poll: loadToolDescription('poll'), cancel: loadToolDescription('cancel') })

      return server
   }
}
