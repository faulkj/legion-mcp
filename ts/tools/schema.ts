import * as z from 'zod/v4'
import { slugify } from '../config/config.js'

// Every field is optional: endpoints vary in what they report, and a missing one must not fail output validation.
const usageSchema = () => z.object({
   inputTokens: z.number().optional(),
   outputTokens: z.number().optional(),
   totalTokens: z.number().optional(),
   reasoningTokens: z.number().optional()
})

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
      cameoRound: z.number().int().min(1).max(maxRounds).optional().describe(d('cameoRound')),
      objectives: z.record(z.string(), z.string()).optional().describe(d('objectives')),
      tokenBudget: z.number().int().positive().optional().describe(d('tokenBudget')),
      ...buildInputSchema(schema).omit({ role: true }).shape
   }
}

/**
 * `structuredContent` a single model tool returns. Declaring it lets a client validate and type the
 * result, but the SDK enforces it too: a mismatch is rewritten into an `isError` result, so every
 * optional field here must stay optional. Error paths return no `structuredContent` and are exempt.
 */
export const modelOutputSchema = {
   tool: z.string().describe('Slug of the tool that answered.'),
   modelName: z.string().describe('Config file name backing the tool.'),
   modelId: z.string().describe('Deployed model id that was called.'),
   role: z.string().optional().describe('Role applied to the call, when one was requested.'),
   usage: usageSchema().describe('Token usage as reported by the endpoint; fields are absent when it reports none.'),
   latencyMs: z.number().describe('Round-trip time for the model call.'),
   status: z.string().describe('`ok`, or `truncated` / `reasoning-heavy` (may combine).')
}

/** `structuredContent` the quorum and preset tools return: per-turn telemetry, the ordered event timeline, and the rendered transcript. */
export const quorumOutputSchema = {
   turns: z.array(z.object({
      index: z.number().describe('Stable seat identity — position in `models[]`; -1 for seatless notes.'),
      selector: z.string(),
      modelName: z.string(),
      modelId: z.string(),
      role: z.string().optional(),
      round: z.number().describe('Round the turn belongs to; 0 is the end-of-run synthesis.'),
      phase: z.string().describe('frame | round | entry | closing | vote | synthesis | elimination'),
      usage: usageSchema(),
      latencyMs: z.number(),
      status: z.string(),
      contentIndex: z.number().optional().describe('Index of this turn in `content[]`, when it produced answer text.'),
      eliminatedIndex: z.number().optional().describe('Seat removed by an elimination turn.')
   })).describe('Every turn taken, in council order.'),
   timeline: z.array(z.object({
      round: z.number(),
      phase: z.string(),
      who: z.string().optional().describe('Role label; absent for seatless events such as an anonymous vote.'),
      detail: z.string().optional().describe('Vote tally, elimination target, or a skip/error status.')
   })).describe('The run as an ordered event log — the shape of the deliberation without parsing the transcript.'),
   transcript: z.string().describe('Full labelled transcript; feed back as `context` to continue a run across calls.'),
   preset: z.string().optional().describe('Preset key, when the run used one.'),
   budget: z.object({
      limit: z.number(),
      used: z.number(),
      exceeded: z.boolean()
   }).optional().describe('Token budget accounting, when a budget applied.')
}

/** Render the available models for a tool description: `slug — description` per model (bare slug when undescribed), semicolon-separated. */
export const modelList = (models: ModelDef[]): string =>
   models.map(m => m.description ? `${slugify(m.name)} — ${m.description}` : slugify(m.name)).join('; ')

/** One-line staffing hint per preset role: `contestant (2+)`, `juror (3-12)`, `judge (one)`, `security (optional)`, `helper (up to 3)`. */
export const roleCardinality = (role: PresetRole): string => {
   const
      slug = slugify(role.role),
      min = role.min ?? 1,
      max = role.max === null ? undefined : (role.max ?? 1)
   return max === undefined
      ? `${slug} (${min}+)`
      : min === 0
         ? max === 1 ? `${slug} (optional)` : `${slug} (up to ${max})`
         : min === max
            ? min === 1 ? `${slug} (one)` : `${slug} (${min})`
            : `${slug} (${min}-${max})`
}
