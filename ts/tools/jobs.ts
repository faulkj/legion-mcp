import { McpServer } from '@modelcontextprotocol/server'
import { fill } from '../config/config.js'
import { handleResult } from './council.js'
import { cancelInputSchema, jobOutputSchema, pollInputSchema } from './jobSchema.js'

/** Register `poll` and `cancel` for the job service. `poll` is read-only so hosts that gate writes behind approval let it through silently. */
export const registerJobTools = (server: McpServer, jobs: JobService, errors: ErrorMessages, descriptions: { poll?: string; cancel?: string }): void => {
   const notFound = (jobId: string): CallToolResultLike => ({ content: [{ type: 'text', text: fill(errors.jobNotFound, { jobId }) }], isError: true })

   server.registerTool(
      'poll',
      {
         description: descriptions.poll ?? 'Retrieve the current state and output of a running or finished council job. Never starts a run.',
         inputSchema: pollInputSchema,
         outputSchema: jobOutputSchema,
         annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      },
      ({ jobId, full }, ctx) => {
         const view = jobs.poll(jobId, ctx, full === true)
         return view ? handleResult(view, errors) : notFound(jobId)
      }
   )

   server.registerTool(
      'cancel',
      {
         description: descriptions.cancel ?? 'Request that a council job stop, and return whatever it has produced so far. Poll afterwards to see the settled partial result.',
         inputSchema: cancelInputSchema,
         outputSchema: jobOutputSchema,
         annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
      },
      ({ jobId }, ctx) => {
         const view = jobs.cancel(jobId, ctx)
         return view ? handleResult(view, errors) : notFound(jobId)
      }
   )
}

/** Tool names a model or preset may not use; `poll`/`cancel` are only reserved when async mode exposes them. */
export const reservedNames = (asyncTools: boolean): Set<string> =>
   new Set(asyncTools ? ['quorum', 'poll', 'cancel'] : ['quorum'])
