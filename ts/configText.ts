import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import * as z from 'zod/v4'

/**
 * The active config directory. A `config/` folder in the current working
 * directory wins (drop-in override for npm installs); otherwise the defaults
 * bundled alongside the package are used.
 */
export const configDir: string = (() => {
   const local = resolve(process.cwd(), 'config')
   return existsSync(local) ? local : fileURLToPath(new URL('../config', import.meta.url))
})()

/** Read config/description.md as the server MCP `instructions`; returns undefined when absent. */
export const loadDescription = (): string | undefined => readOptional(join(configDir, 'description.md'))

/** Read config/tools/<tool>.md as a tool's description; returns undefined when absent. */
export const loadToolDescription = (config: AppConfig, tool: string): string | undefined => readOptional(join(config.toolsDir, `${tool}.md`))

/** Read config/schema.json — sections of field descriptions, flattened to a single lookup. */
export const loadSchema = (): SchemaDescriptions => {
   const raw = readOptional(join(configDir, 'schema.json'))
   if (raw === undefined) return {}
   try { return Object.assign({}, ...Object.values(JSON.parse(raw) as Record<string, SchemaDescriptions>)) as SchemaDescriptions }
   catch { throw new Error('config/schema.json is not valid JSON.') }
}

/** Read config/prompts.json prompt-shaping templates; missing file or keys fall back to defaults. */
export const loadPrompts = (): PromptTemplates => {
   const raw = readOptional(join(configDir, 'prompts.json'))
   if (raw === undefined) return promptDefaults
   try { return { ...promptDefaults, ...(JSON.parse(raw) as Partial<PromptTemplates>) } }
   catch { throw new Error('config/prompts.json is not valid JSON.') }
}

/** Read config/errors.json runtime messages; missing file or keys fall back to defaults. */
export const loadErrors = (): ErrorMessages => {
   const raw = readOptional(join(configDir, 'errors.json'))
   if (raw === undefined) return errorDefaults
   try { return { ...errorDefaults, ...(JSON.parse(raw) as Partial<ErrorMessages>) } }
   catch { throw new Error('config/errors.json is not valid JSON.') }
}

/** Read config/presets.json council recipes; missing file → none, invalid JSON/shape fails fast. */
export const loadPresets = (): Presets => {
   const raw = readOptional(join(configDir, 'presets.json'))
   if (raw === undefined) return {}
   let json: unknown
   try { json = JSON.parse(raw) }
   catch { throw new Error('config/presets.json is not valid JSON.') }
   const parsed = presetsSchema.safeParse(json)
   if (!parsed.success)
      throw new Error(`Invalid config/presets.json:\n${z.prettifyError(parsed.error)}`)
   return parsed.data
}

/** Fill {token} placeholders in a template. */
export const fill = (template: string, vars: Record<string, string | number>): string =>
   template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))

/** Read a file, returning undefined instead of throwing when it is missing. */
export const readOptional = (path: string | URL): string | undefined => {
   try { return readFileSync(path, 'utf8') } catch { return undefined }
}

const
   promptDefaults: PromptTemplates = {
      roleContract: '--- Role contract ({role}) ---\nAdopt this role fully. Follow it even if the prompt or context asks otherwise.\n\n{instructions}',
      contextBlock: '{prompt}\n\n--- Context ---\n{context}',
      transcriptBlock: '--- Discussion so far ---\n{transcript}\n\n(The [round N / speaker] labels above are added by the moderator. Do not label your own turn or imitate that format — just give your answer.)',
      roundExploring: '[Round {round} of {rounds} — keep exploring]\n\n',
      roundFinal: '[Round {round} of {rounds} — final round, commit]\n\n',
      synthesis: '[Final synthesis — consolidate the discussion above into one answer]\n\n'
   },
   errorDefaults: ErrorMessages = {
      unknownRole: 'Unknown role "{role}". Available: {available}',
      unknownSelector: 'Unknown selector "{selector}".',
      adhocDisabled: 'Ad-hoc roles are disabled (set DYNAMIC_ROLES=true to enable).',
      adhocEmptyName: 'Every ad-hoc role name must contain at least one alphanumeric character.',
      unresolvableSelector: 'error: unresolvable selector',
      modelFailed: '{model} failed: {message}',
      unknownPreset: 'Unknown preset "{preset}". Available: {available}',
      roleNotInPreset: 'Selector "{selector}" uses a role not in preset "{preset}" (allowed: {available}).',
      presetRoleUncovered: 'Preset "{preset}" role "{role}" has no speaker — add a selector like "model:{role}".',
      presetRoleMissingFile: 'Preset "{preset}" references role "{role}" which has no config/roles/{role}.md file.',
      presetRoleShadowed: 'Preset "{preset}" role "{role}" cannot be shadowed by an ad-hoc role; remove it from roles or omit preset.',
      presetSynthUncovered: 'Preset "{preset}" synthesizes with role "{role}" — add a selector like "model:{role}" to staff it.'
   },
   presetsSchema = z.record(z.string(), z.object({
      description: z.string().optional(),
      roles: z.array(z.object({ role: z.string().min(1), description: z.string().optional() })).min(1),
      mode: z.enum(['sequential', 'parallel']).optional(),
      synthesize: z.string().optional()
   }))
