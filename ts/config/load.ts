import { join } from 'node:path'
import { bundledDir, localDir, mergeJsonLayers, readLayered, readOptional } from './text.js'

/** Read config/description.md as the server MCP `instructions`; returns undefined when absent. */
export const loadDescription = (): string | undefined => readLayered('description.md')

/** Read config/tools/<tool>.md as a tool's description; returns undefined when absent. */
export const loadToolDescription = (tool: string): string | undefined => readLayered(join('tools', `${tool}.md`))

/** Read bundled config/prompts.json and overlay local keys. */
export const loadPrompts = (): PromptTemplates => mergeJsonLayers('prompts.json')

/** Read bundled config/errors.json and overlay local keys. */
export const loadErrors = (): ErrorMessages => mergeJsonLayers('errors.json')

/** Read config/schema.json — sections of field descriptions, flattened then overlaid (local over bundled). */
export const loadSchema = (): SchemaDescriptions => {
   const flatten = (dir?: string): SchemaDescriptions => {
      const raw = dir && readOptional(join(dir, 'schema.json'))
      if (!raw) return {}
      try { return Object.assign({}, ...Object.values(JSON.parse(raw) as Record<string, SchemaDescriptions>)) as SchemaDescriptions }
      catch { throw new Error(`${join(dir, 'schema.json')} is not valid JSON.`) }
   }
   return { ...flatten(bundledDir), ...flatten(localDir) }
}
