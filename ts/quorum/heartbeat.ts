import type { ServerContext } from '@modelcontextprotocol/server'

/**
 * Run a council with a periodic heartbeat. Phase boundaries can be minutes apart — one stalled model
 * call alone ran 248s — so boundary-only notifications leave the caller silent long enough to trip
 * its deadline. Heartbeats and phase announcements share one counter, because MCP requires a
 * strictly increasing progress value. A reporter that throws must not fail the run, so emissions
 * swallow their errors. Callers that send no `progressToken` get nothing here, per spec, and rely
 * on the transport's keepalive frames instead.
 */
export const withHeartbeat = <T>(ctx: ServerContext, run: (report: ReportPhase) => Promise<T>): Promise<T> =>
   heartbeat(progressFor(ctx), run)

const
   intervalMs = 15_000,

   progressFor = (ctx: ServerContext): OnProgress | undefined => {
      const progressToken = ctx.mcpReq._meta?.progressToken
      if (progressToken === undefined) return undefined
      return (progress, message) => ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken, progress, message } })
   },

   heartbeat = async <T>(onProgress: OnProgress | undefined, run: (report: ReportPhase) => Promise<T>): Promise<T> => {
      if (!onProgress) return run(() => {})

      let
         step = 0,
         phase = 'starting'

      const
         emit = async (message: string) => { try { await onProgress(++step, message) } catch {} },
         report: ReportPhase = message => (phase = message, emit(message)),
         timer = setInterval(() => void emit(`${phase} — still working`), intervalMs)

      timer.unref?.()
      try { return await run(report) }
      finally { clearInterval(timer) }
   }
