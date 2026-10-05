import type { ServerContext } from '@modelcontextprotocol/server'
import { randomUUID } from 'node:crypto'
import { log } from '../core/log.js'
import { snapshotRun } from '../quorum/snapshot.js'
import { ownerOf } from './owner.js'

/**
 * Process-wide in-memory job service for detached council runs. `start` admits a run, returns a
 * handle at once, and executes in the background under a job-owned AbortController. `poll` and
 * `cancel` authorize against the stored owner, then project a copied public snapshot. Jobs live
 * only in this process: a restart or a request routed to another replica cannot find them.
 */
export const makeJobService = (config: AppConfig, templates: PromptTemplates): JobService => {
   const
      jobs = new Map<string, Job>(),
      { jobLimits: limits, trustProxyAuth } = config,
      active = () => [...jobs.values()].filter(j => j.state === 'running' || j.state === 'cancelling').length

   const sweep = (): void => {
      const cutoff = Date.now() - limits.retainMs
      for (const [id, j] of jobs)
         j.settledAt !== undefined && j.settledAt < cutoff && jobs.delete(id)
      const retained = [...jobs.values()].filter(j => j.settledAt !== undefined).sort((a, b) => a.settledAt! - b.settledAt!)
      for (const j of retained.slice(0, Math.max(0, retained.length - limits.maxRetained))) jobs.delete(j.id)
   }

   const settle = (job: Job, state: 'completed' | 'failed' | 'cancelled', result?: QuorumResult, error?: string): void => {
      if (job.settledAt !== undefined) return
      Object.assign(job, { state, result, error, settledAt: Date.now() })
      log('info', `🧵 job ${job.id} ${state} (${job.tool}, ${Math.round((job.settledAt! - job.startedAt) / 1000)}s)`)
      sweep()
   }

   const view = (job: Job, full: boolean): JobView => {
      const live = job.runner && job.labels ? snapshotRun(job.runner, job.labels, templates, full) : undefined
      return {
         jobId: job.id,
         tool: job.tool,
         state: job.state,
         phase: live?.phase ?? (job.state === 'running' ? 'starting' : job.state),
         elapsedMs: (job.settledAt ?? Date.now()) - job.startedAt,
         pollIntervalMs: limits.pollIntervalMs,
         ...(live ? { answers: live.answers, notes: live.notes, turns: live.turns, waitingOn: live.waitingOn, usage: live.usage } : {}),
         ...(full && live?.transcript !== undefined ? { transcript: live.transcript, timeline: live.timeline } : {}),
         ...(job.settledAt !== undefined ? { expiresAt: new Date(job.settledAt + limits.retainMs).toISOString() } : {}),
         ...(job.result && (full || job.state !== 'running') ? { result: job.result } : {}),
         ...(job.error !== undefined ? { error: job.error } : {})
      }
   }

   const find = (id: string, ctx: ServerContext): Job | undefined => {
      const job = jobs.get(id)
      return job && job.owner === ownerOf(ctx, trustProxyAuth) ? job : undefined
   }

   return {
      start: (tool, ctx, run) => {
         sweep()
         if (active() >= limits.maxActive) return { kind: 'busy', active: active(), max: limits.maxActive }
         const
            controller = new AbortController(),
            job: Job = { id: randomUUID(), tool, owner: ownerOf(ctx, trustProxyAuth), state: 'running', startedAt: Date.now(), controller }
         jobs.set(job.id, job)
         log('info', `🧵 job ${job.id} started (${tool})`)
         run(controller.signal, (runner, labels) => { job.runner = runner; job.labels = labels }, job.id)
            .then(result => settle(job, controller.signal.aborted ? 'cancelled' : 'completed', result))
            .catch(err => settle(job, controller.signal.aborted ? 'cancelled' : 'failed', undefined, err instanceof Error ? err.message : String(err)))
         return { kind: 'started', view: view(job, false) }
      },
      poll: (id, ctx, full) => {
         const job = find(id, ctx)
         return job ? view(job, full) : undefined
      },
      cancel: (id, ctx) => {
         const job = find(id, ctx)
         if (!job) return undefined
         if (job.state === 'running') job.state = 'cancelling', job.controller.abort()
         return view(job, false)
      },
      counts: () => ({ active: active(), retained: jobs.size - active() }),
      shutdown: async () => {
         const running = [...jobs.values()].filter(j => j.settledAt === undefined)
         running.forEach(j => (j.state = 'cancelling', j.controller.abort()))
         const deadline = Date.now() + limits.shutdownGraceMs
         while (running.some(j => j.settledAt === undefined) && Date.now() < deadline)
            await new Promise(r => setTimeout(r, 100))
      }
   }
}
