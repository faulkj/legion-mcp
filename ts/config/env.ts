import { join } from 'node:path'
import * as z from 'zod/v4'
import { csv, packageRoot, readOptional, slugify } from './text.js'

/** Parse and validate environment configuration, failing fast on any problem. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
   const parsed = envSchema.safeParse(env)
   if (!parsed.success)
      throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`)

   const {
      DEFAULT_BASE_URL, DEFAULT_API_KEY, ALLOW_NO_MODELS, MCP_TRANSPORT, HOST, ALLOWED_HOSTS, PORT, MAX_ROUNDS, MODEL_TIMEOUT, TOKEN_BUDGET, DYNAMIC_ROLES, PRESETS, LOG_LEVEL,
      ASYNC_TOOLS, TRUST_PROXY_AUTH, JOB_RETAIN_MS, JOB_MAX_ACTIVE, JOB_MAX_RETAINED, JOB_POLL_INTERVAL_MS, JOB_SHUTDOWN_GRACE_MS
   } = parsed.data

   return {
      ...readPackage(),
      defaultBaseUrl: DEFAULT_BASE_URL?.replace(/\/+$/, ''),
      defaultApiKey: DEFAULT_API_KEY,
      allowNoModels: ALLOW_NO_MODELS === 'true',
      transport: MCP_TRANSPORT,
      host: HOST,
      allowedHosts: csv(ALLOWED_HOSTS),
      port: PORT,
      maxRounds: MAX_ROUNDS,
      modelTimeout: MODEL_TIMEOUT,
      tokenBudget: TOKEN_BUDGET,
      dynamicRoles: DYNAMIC_ROLES === 'true',
      presets: csv(PRESETS)?.map(slugify),
      logLevel: LOG_LEVEL,
      asyncTools: ASYNC_TOOLS === 'true',
      trustProxyAuth: TRUST_PROXY_AUTH === 'true',
      jobLimits: { retainMs: JOB_RETAIN_MS, maxActive: JOB_MAX_ACTIVE, maxRetained: JOB_MAX_RETAINED, pollIntervalMs: JOB_POLL_INTERVAL_MS, shutdownGraceMs: JOB_SHUTDOWN_GRACE_MS }
   }
}

const
   envSchema = z.object({
      DEFAULT_BASE_URL: z.url('DEFAULT_BASE_URL must be a valid URL').optional(),
      DEFAULT_API_KEY: z.string().min(1).optional(),
      ALLOW_NO_MODELS: z.enum(['true', 'false']).default('false'),
      MCP_TRANSPORT: z.enum(['http', 'stdio'], { error: 'MCP_TRANSPORT must be "http" or "stdio"' }).default('http'),
      HOST: z.string().min(1).default('127.0.0.1'),
      ALLOWED_HOSTS: z.string().optional(),
      PORT: z.coerce.number().int().positive().default(5000),
      MAX_ROUNDS: z.coerce.number().int().positive().default(5),
      MODEL_TIMEOUT: z.coerce.number().int().positive().default(90_000),
      TOKEN_BUDGET: z.coerce.number().int().positive().optional(),
      DYNAMIC_ROLES: z.enum(['true', 'false']).default('true'),
      PRESETS: z.string().optional(),
      LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      ASYNC_TOOLS: z.enum(['true', 'false']).default('false'),
      TRUST_PROXY_AUTH: z.enum(['true', 'false']).default('false'),
      JOB_RETAIN_MS: z.coerce.number().int().positive().default(1_800_000),
      JOB_MAX_ACTIVE: z.coerce.number().int().positive().default(3),
      JOB_MAX_RETAINED: z.coerce.number().int().positive().default(20),
      JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
      JOB_SHUTDOWN_GRACE_MS: z.coerce.number().int().nonnegative().default(20_000)
   }),

   readPackage = (): { name: string; version: string } => {
      const { name = 'mcp-server', version = '0.0.0' } = JSON.parse(readOptional(join(packageRoot, 'package.json')) ?? '{}')
      return { name, version }
   }
