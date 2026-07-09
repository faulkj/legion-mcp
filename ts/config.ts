import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as z from 'zod/v4'
import { configDir, readOptional } from './configText.js'

export { configDir, fill, loadDescription, loadErrors, loadPrompts, loadSchema, loadToolDescription } from './configText.js'

/** Turn a model file name into a tool-name slug. */
export const slugify = (name: string): string =>
   name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/** Parse and validate environment configuration, failing fast on any problem. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
   const parsed = envSchema.safeParse(env)
   if (!parsed.success)
      throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`)

   const { DEFAULT_BASE_URL, DEFAULT_API_KEY, HOST, ALLOWED_HOSTS, PORT, MAX_ROUNDS, TOKEN_BUDGET, DYNAMIC_ROLES, LOG_LEVEL } = parsed.data

   return {
      ...readPackage(),
      modelsDir: join(configDir, 'models'),
      rolesDir: join(configDir, 'roles'),
      toolsDir: join(configDir, 'tools'),
      defaultBaseUrl: DEFAULT_BASE_URL?.replace(/\/+$/, ''),
      defaultApiKey: DEFAULT_API_KEY,
      host: HOST,
      allowedHosts: ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean),
      port: PORT,
      maxRounds: MAX_ROUNDS,
      tokenBudget: TOKEN_BUDGET,
      dynamicRoles: DYNAMIC_ROLES === 'true',
      logLevel: LOG_LEVEL
   }
}

/** Scan config/roles/*.md; returns empty array when the directory does not exist. */
export const loadRoles = (config: AppConfig): RoleDef[] => {
   let files: string[]
   try { files = readdirSync(config.rolesDir).filter(f => f.endsWith('.md')) }
   catch { return [] }
   const
      roles = files.map(f => ({ name: slugify(basename(f, '.md')), instructions: readFileSync(join(config.rolesDir, f), 'utf8') })),
      seen = new Set<string>()
   roles.forEach(r => seen.has(r.name) ? (() => { throw new Error(`Role slug collision: "${r.name}". Rename one.`) })() : seen.add(r.name))
   return roles
}

/** Scan the models directory: each `<name>.json` becomes a tool named after the slugified file name. */
export const loadModels = (config: AppConfig): ModelDef[] => {
   let files: string[]
   try { files = readdirSync(config.modelsDir).filter(f => f.endsWith('.json') && !f.endsWith('.example.json')) }
   catch { throw new Error(`Models directory "${config.modelsDir}" not found.`) }
   if (!files.length)
      throw new Error(`No model files found in "${config.modelsDir}". Add e.g. ${config.modelsDir}/fable.json`)

   const models = files.map(f => parseModelFile(config.modelsDir, f))
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
      LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
   }),

   readPackage = (): { name: string; version: string } => {
      const { name = 'mcp-server', version = '0.0.0' } = JSON.parse(readOptional(new URL('../package.json', import.meta.url)) ?? '{}')
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
