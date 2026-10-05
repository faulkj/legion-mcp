import * as z from 'zod/v4'
import { quorumOutputSchema } from './schema.js'

/** `structuredContent` a council tool returns in async mode, and what `poll`/`cancel` return: the job handle plus the current public snapshot. `result` is the original council output once terminal. */
export const jobOutputSchema = {
   jobId: z.string().describe('Opaque handle for `poll` and `cancel`.'),
   tool: z.string().describe('Council tool that started this job.'),
   state: z.enum(['running', 'cancelling', 'completed', 'failed', 'cancelled']).describe('`completed` may still carry `result.isError: true` (a tool error); `failed` means the run itself threw.'),
   phase: z.string().describe('Human-readable step the run is on, e.g. `round 2/4`, `voting`, `synthesizing`.'),
   elapsedMs: z.number(),
   pollIntervalMs: z.number().describe('Suggested delay before the next `poll`.'),
   answers: z.array(z.string()).optional().describe('Completed answer texts so far, in council order (parallel turns that finished early appear before they are committed).'),
   notes: z.array(z.string()).optional().describe('Public tally, elimination and entry notes so far.'),
   turns: quorumOutputSchema.turns.optional().describe('Per-turn telemetry so far; same shape as the final `turns`.'),
   waitingOn: z.array(z.object({
      who: z.string().describe('Seat label.'),
      phase: z.string(),
      round: z.number(),
      elapsedMs: z.number().describe('How long this call has been outstanding.')
   })).optional().describe('Model calls launched but not yet settled — who the run is waiting on right now.'),
   usage: z.number().optional().describe('Total tokens consumed so far.'),
   transcript: z.string().optional().describe('Rendered transcript; only with `full: true`.'),
   timeline: quorumOutputSchema.timeline.optional().describe('Ordered event log; only with `full: true`.'),
   expiresAt: z.string().optional().describe('When a settled job is dropped from the server.'),
   result: z.object({
      content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
      structuredContent: z.object({ ...quorumOutputSchema, cancelled: z.literal(true).optional() }),
      isError: z.boolean()
   }).optional().describe('The complete original council result once the job is terminal.'),
   error: z.string().optional().describe('Executor error message when `state` is `failed`.')
}

/** Inputs for `poll`. */
export const pollInputSchema = {
   jobId: z.string().min(1).describe('Handle returned when the council started.'),
   full: z.boolean().optional().describe('Include the rendered transcript and timeline (large). Default false.')
}

/** Inputs for `cancel`. */
export const cancelInputSchema = {
   jobId: z.string().min(1).describe('Handle returned when the council started.')
}
