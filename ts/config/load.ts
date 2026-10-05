import { join } from 'node:path'
import { log } from '../core/log.js'
import { bundledDir, localDir, mergeJsonLayers, readLayered, readOptional } from './text.js'

/**
 * Read config/description.md as the server MCP `instructions`; returns undefined when absent.
 * The literal `{longRuns}` marker is replaced with the sync or async delivery snippet
 * (config/sync/long-runs.md or config/async/long-runs.md, layered). Only that marker is
 * substituted — the file is not run through `fill`, so other braces survive. A local override
 * without the marker is left as written and a warning is logged once.
 */
export const loadDescription = (asyncTools = false): string | undefined => {
   const
      text = readLayered('description.md'),
      marker = '{longRuns}'
   if (text === undefined) return undefined
   if (!text.includes(marker)) {
      warnedMarker || (warnedMarker = true, log('warn', `⚠️ description.md has no ${marker} marker — long-run delivery guidance for ${asyncTools ? 'async' : 'sync'} mode is not being emitted`))
      return text
   }
   const snippet = readLayered(join(asyncTools ? 'async' : 'sync', 'long-runs.md'))
   if (snippet === undefined) throw new Error(`Required bundled config ${asyncTools ? 'async' : 'sync'}/long-runs.md is missing.`)
   return text.replaceAll(marker, snippet.trim())
}

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

let warnedMarker = false
