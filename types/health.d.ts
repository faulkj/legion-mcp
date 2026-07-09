/** Per-model result of a deep health probe (`GET /health?deep`). */
interface ModelHealth {
   name: string
   model: string
   ok: boolean
   latencyMs: number
   error?: string
}

/** Deep health report: liveness fields plus one entry per probed model. */
interface HealthReport {
   status: 'ok' | 'degraded'
   name: string
   version: string
   models: ModelHealth[]
}
