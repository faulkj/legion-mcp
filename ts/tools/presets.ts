import { McpServer } from '@modelcontextprotocol/server'
import { slugify } from '../config/config.js'
import { makeCouncilHandler } from './council.js'
import { reservedNames } from './jobs.js'
import { jobOutputSchema } from './jobSchema.js'
import { modelList, quorumOutputSchema, quorumShape, roleCardinality } from './schema.js'

/** Register one tool per preset. Each staffs its own roles via `models` selectors and reuses the quorum engine. */
export const registerPresetTools = (server: McpServer, deps: CouncilDeps, schema: SchemaDescriptions = {}): void => {
   const
      { models, config, presets, jobs } = deps,
      d = (key: string) => schema[key] ?? '',
      names = models.map(m => slugify(m.name)),
      modelSlugs = new Set(names),
      reserved = reservedNames(config.asyncTools),
      handler = makeCouncilHandler(deps)

   for (const [key, preset] of Object.entries(presets)) {
      const toolName = slugify(key)
      if (reserved.has(toolName) || modelSlugs.has(toolName))
         throw new Error(`Preset "${key}" maps to tool "${toolName}", which collides with a model tool or a reserved tool name (${[...reserved].join(', ')}). Rename it.`)

      const
         floor = preset.roles.reduce((n, r) => n + (r.min ?? 1), 0),
         staffing = preset.roles.map(roleCardinality).join(', '),
         synthLine = preset.synthesize ? ` ${slugify(preset.synthesize)} also synthesizes.` : '',
         presetSchema = quorumShape(schema, config.maxRounds, floor, `${d('models')} Staff via model:role selectors — ${staffing}. Available models: ${names.join(', ')}.`),
         run = handler(toolName)

      server.registerTool(
         toolName,
         {
            description: `${preset.description}\n\nStaff via models[]: ${staffing}.${synthLine} Available models: ${modelList(models)}.`,
            inputSchema: presetSchema,
            outputSchema: jobs ? jobOutputSchema : quorumOutputSchema
         },
         (args: QuorumInput, ctx) => run({ ...args, preset: key }, ctx)
      )
   }
}
