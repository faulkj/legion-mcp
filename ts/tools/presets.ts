import { McpServer } from '@modelcontextprotocol/server'
import { slugify } from '../config/config.js'
import { runQuorum } from '../quorum/quorum.js'
import { withHeartbeat } from '../quorum/heartbeat.js'
import { createPrompt } from '../core/llm.js'
import { modelList, quorumOutputSchema, quorumShape, roleCardinality } from './schema.js'

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
            inputSchema: presetSchema,
            outputSchema: quorumOutputSchema
         },
         (args: QuorumInput, ctx) => withHeartbeat(ctx, r => runQuorum({ ...args, preset: key }, models, roles, prompt, maxRounds, dynamicRoles, templates, errors, args.tokenBudget ?? tokenBudget, presets, r))
      )
   }
}
