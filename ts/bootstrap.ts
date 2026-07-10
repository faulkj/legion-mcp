import { McpServer } from '@modelcontextprotocol/server'
import { loadConfig, loadDescription, loadErrors, loadModels, loadPrompts, loadRoles, loadSchema, loadToolDescription } from './config/config.js'
import { loadPresets } from './config/presets.js'
import { makeProbe } from './core/health.js'
import { createPrompt } from './core/llm.js'
import { setLogLevel } from './core/log.js'
import { registerModelTools, registerPresetTools, registerQuorumTool } from './tools/tools.js'

/** Load config, validate the models directory, and return a per-request server factory plus a deep-health probe. */
export const bootstrap = (): { config: AppConfig; models: ModelDef[]; createServer: () => McpServer; probe: () => Promise<HealthReport> } => {
   const
      config = loadConfig(),
      models = loadModels(config)

   setLogLevel(config.logLevel)
   return { config, models, createServer: makeServerFactory(config), probe: makeProbe(config) }
}

/** Build a factory that re-scans the models directory per request — drop in a JSON, get a tool. */
export const makeServerFactory = (config: AppConfig): () => McpServer => {
   const basePrompt = createPrompt(config)

   return () => {
      const
         description = loadDescription(),
         server = new McpServer(
            { name: config.name, version: config.version },
            description === undefined ? {} : { instructions: description }
         ),
         models = loadModels(config),
         roles = loadRoles(),
         schema = loadSchema(),
         templates = loadPrompts(),
         errors = loadErrors(),
         presets = loadPresets(config),
         // Forward roles + templates so quorum can pass its effective (file + ad-hoc) roles; both default here.
         prompt: ReturnType<typeof createPrompt> = (def, input, override, tpl) => basePrompt(def, input, override ?? roles, tpl ?? templates)

      registerModelTools(server, models, roles, prompt, errors, schema)
      registerQuorumTool(server, models, roles, prompt, config.maxRounds, config.dynamicRoles, templates, errors, config.tokenBudget, presets, loadToolDescription('quorum'), schema)
      registerPresetTools(server, models, roles, prompt, config.maxRounds, config.dynamicRoles, templates, errors, config.tokenBudget, presets, schema)

      return server
   }
}
