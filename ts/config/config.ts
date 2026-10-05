import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as z from 'zod/v4'
import { log } from '../core/log.js'
import { bundledDir, layeredFiles, localDir, resolveEnvRef, slugKey, slugify } from './text.js'

export { fill, slugify } from './text.js'

export { loadConfig } from './env.js'

export { loadDescription, loadErrors, loadPrompts, loadSchema, loadToolDescription } from './load.js'

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
      omitParams: z.array(z.string()).optional(),
      reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional()
   }),

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
