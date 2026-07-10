import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { fill, slugify } from '../config/config.js'
import { runQuorum } from '../quorum/quorum.js'
import { createPrompt } from '../core/llm.js'
import { logPrompt, okStatus, promptEntry } from '../core/log.js'
import { buildInputSchema, modelList, quorumShape, roleCardinality } from './schema.js'

/** Register one tool per model definition on the given server. */
export const registerModelTools = (
   server: McpServer,
   models: ModelDef[],
   roles: RoleDef[],
   prompt: ReturnType<typeof createPrompt>,
   errors: ErrorMessages,
   schema: SchemaDescriptions = {}
): void => {
   const inputSchema = buildInputSchema(schema)
   for (const def of models) {
      const
         toolName = slugify(def.name),
         description = def.description ?? `Prompt the ${def.name} model (${def.model}).`

      server.registerTool(toolName, { description, inputSchema }, async (input: PromptInput) => {
         if (input.role !== undefined && !roles.find(r => r.name === input.role))
            return { content: [{ type: 'text', text: fill(errors.unknownRole, { role: input.role, available: roles.map(r => r.name).join(', ') || 'none' }) }], isError: true }
         try {
            const result = await prompt(def, input)
            logPrompt(promptEntry(def, input, { response: result.text, usage: result.usage, latencyMs: result.latencyMs }, toolName))
            return {
               content: [{ type: 'text', text: result.text }],
               structuredContent: { tool: toolName, modelName: def.name, modelId: def.model, role: input.role, usage: result.usage, latencyMs: result.latencyMs, status: okStatus(result) }
            }
         } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logPrompt(promptEntry(def, input, { error: message }, toolName))
            return { content: [{ type: 'text', text: fill(errors.modelFailed, { model: def.name, message }) }], isError: true }
         }
      })
   }
}

/** Register the quorum fan-out tool. */
export const registerQuorumTool = (
   server: McpServer,
   models: ModelDef[],
   roles: RoleDef[],
   prompt: ReturnType<typeof createPrompt>,
   maxRounds: number,
   dynamicRoles: boolean,
   templates: PromptTemplates,
   errors: ErrorMessages,
   tokenBudget?: number,
   presets: Presets = {},
   description?: string,
   schema: SchemaDescriptions = {}
): void => {
   const
      d = (key: string) => schema[key] ?? '',
      names = models.map(m => slugify(m.name)),
      quorumSchema = {
         ...quorumShape(schema, maxRounds, 2, `${d('models')} Available models: ${names.join(', ')}`),
         roles: z.record(z.string(), z.string()).optional().describe(d('roles')),
         mode: z.enum(['sequential', 'parallel', 'private', 'independent']).optional().describe(d('mode')),
         synthesize: z.string().optional().describe(d('synthesize')),
         synthesizeEvery: z.union([z.literal('end'), z.number().int().min(0)]).optional().describe(d('synthesizeEvery')),
         closingStatements: z.boolean().optional().describe(d('closingStatements'))
      },
      fallback = 'Fan a prompt out to two or more models (see config/tools/quorum.md).'

   server.registerTool(
      'quorum',
      {
         description: `${description ?? fallback}\n\nAvailable models: ${modelList(models)}.`,
         inputSchema: quorumSchema
      },
      (args: QuorumInput) => runQuorum(args, models, roles, prompt, maxRounds, dynamicRoles, templates, errors, args.tokenBudget ?? tokenBudget, presets)
   )
}

/** Register one tool per preset. Each staffs its own roles via `models` selectors and reuses the quorum engine. */
export const registerPresetTools = (
   server: McpServer,
   models: ModelDef[],
   roles: RoleDef[],
   prompt: ReturnType<typeof createPrompt>,
   maxRounds: number,
   dynamicRoles: boolean,
   templates: PromptTemplates,
   errors: ErrorMessages,
   tokenBudget: number | undefined,
   presets: Presets,
   schema: SchemaDescriptions = {}
): void => {
   const
      d = (key: string) => schema[key] ?? '',
      names = models.map(m => slugify(m.name)),
      modelSlugs = new Set(names)

   for (const [key, preset] of Object.entries(presets)) {
      const toolName = slugify(key)
      if (toolName === 'quorum' || modelSlugs.has(toolName))
         throw new Error(`Preset "${key}" maps to tool "${toolName}", which collides with a model tool or the reserved name "quorum". Rename it.`)

      const
         floor = preset.roles.reduce((n, r) => n + (r.min ?? 1), 0),
         staffing = preset.roles.map(roleCardinality).join(', '),
         synthLine = preset.synthesize ? ` ${slugify(preset.synthesize)} also synthesizes.` : '',
         presetSchema = quorumShape(schema, maxRounds, floor, `${d('models')} Staff via model:role selectors — ${staffing}. Available models: ${names.join(', ')}.`)

      server.registerTool(
         toolName,
         {
            description: `${preset.description}\n\nStaff via models[]: ${staffing}.${synthLine} Available models: ${modelList(models)}.`,
            inputSchema: presetSchema
         },
         (args: QuorumInput) => runQuorum({ ...args, preset: key }, models, roles, prompt, maxRounds, dynamicRoles, templates, errors, args.tokenBudget ?? tokenBudget, presets)
      )
   }
}


