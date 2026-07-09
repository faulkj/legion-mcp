import * as z from 'zod/v4'
import { slugify } from '../config/config.js'

/** The prompt fields shared by every tool (models tools include `role`; quorum-family omits it). */
export const buildInputSchema = (schema: SchemaDescriptions = {}) => {
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

/** Shared quorum-family schema: a `models` selector array (min speakers + description) plus rounds/tokenBudget and the base prompt fields (minus `role`). */
export const quorumShape = (schema: SchemaDescriptions, maxRounds: number, minModels: number, modelsDescription: string) => {
   const d = (key: string) => schema[key] ?? ''
   return {
      models: z.array(z.string()).min(minModels).describe(modelsDescription),
      rounds: z.number().int().min(1).max(maxRounds).optional().describe(d('rounds')),
      tokenBudget: z.number().int().positive().optional().describe(d('tokenBudget')),
      ...buildInputSchema(schema).omit({ role: true }).shape
   }
}

/** One-line staffing hint per preset role: `contestant (2+)`, `jury (3-12)`, `judge (one)`. */
export const roleCardinality = (role: PresetRole): string => {
   const
      slug = slugify(role.role),
      min = role.min ?? 1,
      max = role.max === null ? undefined : (role.max ?? 1)
   return max === undefined
      ? `${slug} (${min}+)`
      : min === max
         ? min === 1 ? `${slug} (one)` : `${slug} (${min})`
         : `${slug} (${min}-${max})`
}
