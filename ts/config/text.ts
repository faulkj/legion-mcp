import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'

/** Turn a file/role/model name into a tool-name slug. */
export const slugify = (name: string): string =>
   name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/** Split a comma-separated env value into trimmed, non-empty parts; undefined when unset. */
export const csv = (value?: string): string[] | undefined =>
   value?.split(',').map(s => s.trim()).filter(Boolean)

/**
 * The package root — the nearest ancestor of this module holding a `package.json`.
 * Walking up (rather than assuming a fixed depth) makes it correct whether the code
 * runs bundled in `bin/` or straight from source in `ts/config/` under tsx.
 */
export const packageRoot: string = (() => {
   let dir = dirname(fileURLToPath(import.meta.url))
   while (!existsSync(join(dir, 'package.json')) && dirname(dir) !== dir) dir = dirname(dir)
   return dir
})()

/** The config bundled alongside the package — always present, always the base layer. */
export const bundledDir: string = join(packageRoot, 'config')

/** A `config/` folder in the current working directory, overlaid on top of the bundle; undefined when absent. */
export const localDir: string | undefined = (() => {
   const local = resolve(process.cwd(), 'config')
   return existsSync(local) ? local : undefined
})()

/** Read a config file by relative path: local overlay wins, else the bundled base, else undefined. */
export const readLayered = (rel: string): string | undefined =>
   (localDir && readOptional(join(localDir, rel))) ?? readOptional(join(bundledDir, rel))

/**
 * Merge the bundled + local copies of a single JSON config file over hardcoded defaults,
 * per key. Precedence: defaults < bundled < local. Missing files fall through; invalid
 * JSON in either layer throws with the offending path.
 */
export const mergeJsonLayers = <T extends object>(rel: string, defaults: T): T => {
   const layer = (dir?: string): Partial<T> => {
      if (!dir) return {}
      const raw = readOptional(join(dir, rel))
      if (raw === undefined) return {}
      try { return JSON.parse(raw) as Partial<T> }
      catch { throw new Error(`${join(dir, rel)} is not valid JSON.`) }
   }
   return { ...defaults, ...layer(bundledDir), ...layer(localDir) }
}

/**
 * Merge files in a subdir across both layers, keyed by a caller-supplied key (usually the
 * slugified basename). Local files override bundled files of the same key; local-only files
 * are added; bundled-only remain. Order is bundled-first, then local-only appended, so tool
 * registration order stays stable. `skip` drops files (e.g. *.example.json) before keying.
 */
export const layeredFiles = (sub: string, ext: string, key: (file: string) => string, skip?: (file: string) => boolean): { key: string; dir: string; file: string }[] => {
   const scan = (dir?: string): { key: string; dir: string; file: string }[] =>
      !dir || !existsSync(join(dir, sub))
         ? []
         : readdirSync(join(dir, sub))
            .filter(f => f.endsWith(ext) && !(skip?.(f) ?? false))
            .map(f => ({ key: key(f), dir: join(dir, sub), file: f })),
      bundled = scan(bundledDir),
      local = scan(localDir),
      localKeys = new Set(local.map(e => e.key))
   return [...bundled.filter(e => !localKeys.has(e.key)), ...local]
}

/** Read config/description.md as the server MCP `instructions`; returns undefined when absent. */
export const loadDescription = (): string | undefined => readLayered('description.md')

/** Read config/tools/<tool>.md as a tool's description; returns undefined when absent. */
export const loadToolDescription = (tool: string): string | undefined => readLayered(join('tools', `${tool}.md`))

/** Read config/schema.json — sections of field descriptions, flattened then overlaid (local over bundled). */
export const loadSchema = (): SchemaDescriptions => {
   const flatten = (dir?: string): SchemaDescriptions => {
      if (!dir) return {}
      const raw = readOptional(join(dir, 'schema.json'))
      if (raw === undefined) return {}
      try { return Object.assign({}, ...Object.values(JSON.parse(raw) as Record<string, SchemaDescriptions>)) as SchemaDescriptions }
      catch { throw new Error(`${join(dir, 'schema.json')} is not valid JSON.`) }
   }
   return { ...flatten(bundledDir), ...flatten(localDir) }
}

/** Read config/prompts.json prompt-shaping templates; missing files or keys fall back to defaults. */
export const loadPrompts = (): PromptTemplates => mergeJsonLayers('prompts.json', promptDefaults)

/** Read config/errors.json runtime messages; missing files or keys fall back to defaults. */
export const loadErrors = (): ErrorMessages => mergeJsonLayers('errors.json', errorDefaults)

/** Slugify a file's basename (drop extension) into a tool/role key. */
export const slugKey = (ext: string) => (file: string): string => slugify(basename(file, ext))

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
      transcriptBlock: '--- Discussion so far ---\n{transcript}\n\n(The [round N / role] labels above are added by the moderator. Do not label your own turn or imitate that format — just give your answer.)',
      roundExploring: '[Round {round} of {rounds} — keep exploring]\n\n',
      roundFinal: '[Round {round} of {rounds} — final round, commit]\n\n',
      roundSynthesis: '[Interim synthesis — consolidate the discussion so far into one working answer to build on]\n\n',
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
      presetRoleUnderStaffed: 'Preset "{preset}" role "{role}" needs at least {min} speaker(s), got {count} — add a selector like "model:{role}".',
      presetRoleOverStaffed: 'Preset "{preset}" role "{role}" allows at most {max} speaker(s), got {count} — remove a "model:{role}" selector.',
      presetRoleMissingFile: 'Preset "{preset}" references role "{role}" which has no config/roles/{role}.md file.',
      presetSynthUncovered: 'Preset "{preset}" synthesizes with role "{role}" — add a selector like "model:{role}" to staff it.'
   }
