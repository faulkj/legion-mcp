import type { ServerContext } from '@modelcontextprotocol/server'
import { fill } from '../config/config.js'
import { withHeartbeat } from '../quorum/heartbeat.js'
import { isQuorumError, prepareQuorum, runQuorum } from '../quorum/quorum.js'

/**
 * Build the shared council handler used by the quorum tool and every preset tool. Sync mode
 * runs the council under the request heartbeat and cancels with the request signal. Async
 * mode validates inline, then hands the prepared run to the job service and returns a handle.
 */
export const makeCouncilHandler = (deps: CouncilDeps) => {
   const { models, roles, prompt, config, templates, errors, presets, jobs } = deps
   return (tool: string) => async (args: QuorumInput, ctx: ServerContext): Promise<CallToolResultLike> => {
      const
         prepared = prepareQuorum(args, models, roles, config.maxRounds, config.dynamicRoles, errors, presets),
         budget = args.tokenBudget ?? config.tokenBudget
      if (isQuorumError(prepared)) return prepared
      if (jobs === undefined)
         return withHeartbeat(ctx, r => runQuorum(prepared, prompt, templates, errors, budget, r, ctx.mcpReq.signal))
      const started = jobs.start(tool, ctx, (signal, onRunner, id) => runQuorum(prepared, prompt, templates, errors, budget, () => {}, signal, onRunner, id.slice(0, 8)))
      return started.kind === 'busy'
         ? { content: [{ type: 'text', text: fill(errors.jobsBusy, { active: started.active, max: started.max }) }], isError: true }
         : handleResult(started.view, errors)
   }
}

/** Render a job view as a tool result: the handle in `structuredContent`, one guidance line in `content`. */
export const handleResult = (view: JobView, errors: ErrorMessages): CallToolResultLike => ({
   content: [{ type: 'text', text: fill(errors.jobHandle, { jobId: view.jobId, state: view.state, phase: view.phase, seconds: Math.round(view.pollIntervalMs / 1000) }) }],
   structuredContent: view
})
