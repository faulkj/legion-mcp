/** Route a level message to the active sink. */
export const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void =>
   sink.level(level, message, meta)

/** Print a prominent green + bold banner to stderr (not gated by log level; keeps stdout clean for stdio transport). */
export const banner = (message: string): void =>
   console.error(stamp(process.stderr.isTTY === true ? `\x1b[1;32m${message}\x1b[0m` : message))

/** Route a completed model-call record to the active sink. */
export const logPrompt = (entry: PromptLogEntry): void => sink.prompt(entry)

/** Success-path status string for telemetry: flags truncation and reasoning-heavy (thin visible output). */
export const okStatus = (r: PromptResult): string =>
   [r.truncated ? 'truncated' : '', r.reasoningHeavy ? 'reasoning-heavy' : ''].filter(Boolean).join(', ') || 'ok'

/** Build a PromptLogEntry from a model call and its outcome — the shape a DB/API sink would persist. */
export const promptEntry = (
   def: ModelDef,
   input: PromptInput,
   outcome: Partial<Pick<PromptLogEntry, 'response' | 'usage' | 'latencyMs' | 'error'>>,
   toolName: string
): PromptLogEntry => ({
   timestamp: new Date().toISOString(),
   toolName,
   modelName: def.name,
   modelId: def.model,
   params: { temperature: input.temperature, maxTokens: input.maxTokens, systemPresent: input.system !== undefined, contextPresent: input.context !== undefined, role: input.role },
   usage: outcome.usage ?? {},
   latencyMs: outcome.latencyMs ?? 0,
   prompt: input.prompt,
   response: outcome.response ?? '',
   ...(outcome.error === undefined ? {} : { error: outcome.error })
})

/** Set the minimum level to emit. Messages below it are dropped. */
export const setLogLevel = (level: LogLevel): void => {
   threshold = order[level]
}

/** Replace the console sink with a custom one (e.g. a future DB/API sink). */
export const setLogSink = (next: LogSink): void => {
   sink = next
}

const
   colorize = (level: LogLevel, text: string): string =>
      enabled ? `\x1b[${codes[level]}m${text}\x1b[0m` : text,

   // In dev (running .ts via tsx) prefix a plaintext timestamp; prod (compiled .js) stays clean.
   isDev = process.argv[1]?.endsWith('.ts') === true,

   stamp = (text: string): string =>
      isDev ? `${localNow()} ${text}` : text,

   localNow = (): string => {
      const d = new Date()
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
   },

   pad = (n: number): string => String(n).padStart(2, '0'),

   codes: Record<LogLevel, string> = {
      debug: '90',
      info: '34',
      warn: '38;5;208',
      error: '31'
   },
   enabled = process.stderr.isTTY === true,
   order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 },
   consoleSink: LogSink = {
      level(level, message, meta) {
         if (order[level] < threshold) return
         const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
         console.error(stamp(colorize(level, `${message}${suffix}`)))
      },
      prompt(entry) {
         const { toolName, modelId, latencyMs, usage, params } = entry
         this.level('info', `🗣️ ${toolName} responded`, { modelId, latencyMs, usage, role: params.role, contextPresent: params.contextPresent })
         if (order.debug < threshold) return
         console.error(stamp(colorize('debug', `   💬 prompt: ${entry.prompt}`)))
         entry.params.role && console.error(stamp(colorize('debug', `   🎭 role: ${entry.params.role}`)))
         entry.params.contextPresent && console.error(stamp(colorize('debug', `   📎 context: (present — see structuredContent)`)))
         console.error(stamp(colorize('debug', `   ✅ response: ${entry.response}`)))
      }
   }

let
   threshold = order.info,
   sink: LogSink = consoleSink
