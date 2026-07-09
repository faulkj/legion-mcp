import { McpServer } from '@modelcontextprotocol/server'
import { loadConfig, loadDescription, loadErrors, loadModels, loadPrompts, loadRoles, loadSchema, loadToolDescription } from './config.js'
import { makeProbe } from './health.js'
import { createPrompt } from './llm.js'
import { setLogLevel } from './log.js'
import { registerModelTools, registerQuorumTool } from './tools.js'

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
         roles = loadRoles(config),
         schema = loadSchema(),
         templates = loadPrompts(),
         errors = loadErrors(),
         // Forward roles + templates so quorum can pass its effective (file + ad-hoc) roles; both default here.
         prompt: ReturnType<typeof createPrompt> = (def, input, override, tpl) => basePrompt(def, input, override ?? roles, tpl ?? templates)

      registerModelTools(server, models, roles, prompt, errors, schema)
      registerQuorumTool(server, models, roles, prompt, config.maxRounds, config.dynamicRoles, templates, errors, loadToolDescription(config, 'quorum'), schema)

      return server
   }
}
