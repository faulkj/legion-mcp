import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as z from 'zod/v4'
import { bundledDir, csv, layeredFiles, localDir, packageRoot, readOptional, slugKey, slugify } from './text.js'

export { fill, loadDescription, loadErrors, loadPrompts, loadSchema, loadToolDescription, slugify } from './text.js'

/** Parse and validate environment configuration, failing fast on any problem. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
   const parsed = envSchema.safeParse(env)
   if (!parsed.success)
      throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`)

   const { DEFAULT_BASE_URL, DEFAULT_API_KEY, HOST, ALLOWED_HOSTS, PORT, MAX_ROUNDS, TOKEN_BUDGET, DYNAMIC_ROLES, DISABLE_PRESETS, LOG_LEVEL } = parsed.data

   return {
      ...readPackage(),
      defaultBaseUrl: DEFAULT_BASE_URL?.replace(/\/+$/, ''),
      defaultApiKey: DEFAULT_API_KEY,
      host: HOST,
      allowedHosts: csv(ALLOWED_HOSTS),
      port: PORT,
      maxRounds: MAX_ROUNDS,
      tokenBudget: TOKEN_BUDGET,
      dynamicRoles: DYNAMIC_ROLES === 'true',
      disabledPresets: csv(DISABLE_PRESETS)?.map(slugify) ?? [],
      logLevel: LOG_LEVEL
   }
}

/** Scan config/roles/*.md across both layers (local wins); returns empty array when none exist. */
export const loadRoles = (): RoleDef[] => {
   const roles = layeredFiles('roles', '.md', slugKey('.md'))
      .map(({ key, dir, file }) => ({ name: key, instructions: readFileSync(join(dir, file), 'utf8') }))
   return roles
}

/** Scan config/models/*.json across both layers (local wins); each becomes a tool named after its slugified file name. */
export const loadModels = (config: AppConfig): ModelDef[] => {
   const files = layeredFiles('models', '.json', slugKey('.json'), f => f.endsWith('.example.json'))
   if (!files.length)
      throw new Error(`No model files found in ${localDir ?? bundledDir}/models. Add e.g. models/fable.json`)

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
      HOST: z.string().min(1).default('127.0.0.1'),
      ALLOWED_HOSTS: z.string().optional(),
      PORT: z.coerce.number().int().positive().default(5000),
      MAX_ROUNDS: z.coerce.number().int().positive().default(5),
      TOKEN_BUDGET: z.coerce.number().int().positive().optional(),
      DYNAMIC_ROLES: z.enum(['true', 'false']).default('true'),
      DISABLE_PRESETS: z.string().optional(),
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

      return { name: basename(file, '.json'), ...result.data }
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
