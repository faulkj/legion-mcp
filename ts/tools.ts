import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { fill, slugify } from './config.js'
import { runQuorum } from './quorum.js'
import { createPrompt } from './llm.js'
import { logPrompt, okStatus, promptEntry } from './log.js'

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
   description?: string,
   schema: SchemaDescriptions = {}
): void => {
   const
      d = (key: string) => schema[key] ?? '',
      names = models.map(m => slugify(m.name)),
      quorumSchema = z.object({
         models: z.array(z.string()).min(2).describe(`${d('models')} Available models: ${names.join(', ')}`),
         roles: z.record(z.string(), z.string()).optional().describe(d('roles')),
         rounds: z.number().int().min(1).max(maxRounds).optional().describe(d('rounds')),
         mode: z.enum(['sequential', 'parallel']).optional().describe(d('mode')),
         synthesize: z.string().optional().describe(d('synthesize')),
         ...buildInputSchema(schema).omit({ role: true }).shape
      })

   const fallback = 'Fan a prompt out to two or more models (see config/tools/quorum.md).'

   server.registerTool(
      'quorum',
      {
         description: `${description ?? fallback}\n\nAvailable models: ${names.join(', ')}.`,
         inputSchema: quorumSchema
      },
      (args: QuorumInput) => runQuorum(args, models, roles, prompt, maxRounds, dynamicRoles, templates, errors)
   )
}

const buildInputSchema = (schema: SchemaDescriptions = {}) => {
   const d = (key: string) => schema[key] ?? ''
   return z.object({
      prompt: z.string().min(1).describe(d('prompt')),
      context: z.string().optional().describe(d('context')),
      role: z.string().optional().describe(d('role')),
      system: z.string().optional().describe(d('system')),
      temperature: z.number().min(0).max(2).optional().describe(d('temperature')),
      maxTokens: z.number().int().positive().optional().describe(d('maxTokens'))
   })
}


