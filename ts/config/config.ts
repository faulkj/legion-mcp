import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as z from 'zod/v4'
import { log } from '../core/log.js'
import { bundledDir, csv, layeredFiles, localDir, packageRoot, readOptional, resolveEnvRef, slugKey, slugify } from './text.js'

export { fill, slugify } from './text.js'

export { loadDescription, loadErrors, loadPrompts, loadSchema, loadToolDescription } from './load.js'

/** Parse and validate environment configuration, failing fast on any problem. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
   const parsed = envSchema.safeParse(env)
   if (!parsed.success)
      throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`)

   const { DEFAULT_BASE_URL, DEFAULT_API_KEY, ALLOW_NO_MODELS, MCP_TRANSPORT, HOST, ALLOWED_HOSTS, PORT, MAX_ROUNDS, MODEL_TIMEOUT, TOKEN_BUDGET, DYNAMIC_ROLES, PRESETS, LOG_LEVEL } = parsed.data

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
      logLevel: LOG_LEVEL
   }
}

/** Scan config/roles/*.md across both layers (local wins); returns empty array when none exist. */
export const loadRoles = (): RoleDef[] =>
   layeredFiles('roles', '.md', slugKey('.md'))
      .map(({ key, dir, file }) => ({ name: key, instructions: readFileSync(join(dir, file), 'utf8') }))

/**
 * Scan config/models/*.json across both layers (local wins); each becomes a tool named after its
 * slugified file name. An empty models directory is fatal unless ALLOW_NO_MODELS=true, which boots
 * with zero model tools (quorum/presets still register but cannot run) for demos and registry sandboxes.
 */
export const loadModels = (config: AppConfig): ModelDef[] => {
   const files = layeredFiles('models', '.json', slugKey('.json'), f => f.endsWith('.example.json'))
   if (!files.length) {
      if (!config.allowNoModels)
         throw new Error(`No model files found in ${localDir ?? bundledDir}/models. Add e.g. models/fable.json`)
      log('warn', `⚠ No model files found in ${localDir ?? bundledDir}/models — model tools disabled; quorum/preset calls will fail until a config/models/*.json exists (ALLOW_NO_MODELS=true)`)
      return []
   }

   const models = files.map(({ dir, file }) => parseModelFile(dir, file))
   assertNoSlugCollisions(models)
   assertResolvable(models, config.defaultBaseUrl, config.defaultApiKey)
   return models
}

const
   modelSchema = z.object({
      model: z.string().min(1),
      description: z.string().optional(),
      system: z.string().optional(),
      baseUrl: z.url().optional(),
      apiKey: z.string().min(1).optional(),
      omitParams: z.array(z.string()).optional()
   }),

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
      LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
   }),

   readPackage = (): { name: string; version: string } => {
      const { name = 'mcp-server', version = '0.0.0' } = JSON.parse(readOptional(join(packageRoot, 'package.json')) ?? '{}')
      return { name, version }
   },

   parseModelFile = (dir: string, file: string): ModelDef => {
      let json: unknown
      try { json = JSON.parse(readFileSync(join(dir, file), 'utf8')) }
      catch { throw new Error(`${file} is not valid JSON.`) }

      const result = modelSchema.safeParse(json)
      if (!result.success)
         throw new Error(`Invalid ${file}:\n${z.prettifyError(result.error)}`)

      const name = basename(file, '.json')
      if (result.data.apiKey)
         result.data.apiKey = resolveEnvRef(result.data.apiKey, `Model "${name}" apiKey`)
      return { name, ...result.data }
   },

   assertNoSlugCollisions = (models: ModelDef[]): void => {
      const seen = new Map<string, string>()
      for (const m of models) {
         const
            slug = slugify(m.name),
            prior = seen.get(slug)
         if (prior)
            throw new Error(`Model files "${prior}" and "${m.name}" both map to tool "${slug}". Rename one.`)
         seen.set(slug, m.name)
      }
   },

   assertResolvable = (models: ModelDef[], baseUrl?: string, apiKey?: string): void => {
      for (const m of models) {
         if (!m.baseUrl && !baseUrl) throw new Error(`Model "${m.name}" has no baseUrl and DEFAULT_BASE_URL is not set.`)
         if (!m.apiKey && !apiKey) throw new Error(`Model "${m.name}" has no apiKey and DEFAULT_API_KEY is not set.`)
      }
   }
