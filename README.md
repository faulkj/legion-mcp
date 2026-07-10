# Legion

> "I am Legion, for we are many."

An [MCP](https://modelcontextprotocol.io) server that exposes LLMs (Claude, GPT,
Gemini, Llama, …) as individual tools. Each configured model becomes a tool,
named after the model, that the calling AI can invoke to get a second opinion.

Every model is reached through the OpenAI **Responses API** wire format.
Endpoints that speak it natively (OpenAI, Azure OpenAI / Foundry) are called
directly; anything else routes through an OpenAI-compatible gateway such as a
[LiteLLM](https://docs.litellm.ai) proxy. Nothing here depends on any particular
gateway.

## How it works

```mermaid
flowchart LR
   AI[Calling AI] -->|claude / gpt / gemini …| Legion
   Legion -->|Responses API| GPT[OpenAI / Azure — direct]
   Legion -->|Responses API| GW[Gateway e.g. LiteLLM]
   GW --> Claude & Gemini & Llama
```

- One tool per model, named after the slugified model name (e.g. `Claude` →
  `claude`, `GPT 4o` → `gpt_4o`).
- Each tool accepts a `prompt` plus optional `context`, `role`, `system`,
  `temperature`, and `maxTokens`.
- A `quorum` tool fans one prompt to two or more models and returns each answer
  as a separate content item. Supports roles via `model:role` selectors (the
  same model can appear multiple times with different roles), inline ad-hoc
  `roles`, multi-round discussion (`rounds`, `mode`), and an optional synthesis
  turn (`synthesize`, timed by `synthesizeEvery`). Transcript turns are labeled
  by **role** (`builder`, `critic 1`), never by model, so models judge each
  other's content rather than reputation. The four `mode`s form a 2×2 of
  *see peers?* × *see own prior turns?* — `sequential` (both), `parallel`
  (peers from earlier rounds only), `private` (own turns only), `independent`
  (nothing but the prompt until synthesis). The calling AI acts as moderator: feed
  `structuredContent.transcript` back as `context` with new guidance to steer a
  live debate. An optional `tokenBudget` (or the `TOKEN_BUDGET` default) sets a
  **soft** cumulative budget for a run: once the running total crosses it,
  remaining turns are skipped gracefully (recorded as `skipped: budget` in
  telemetry, synthesis still runs), so the moderator can see what was dropped and
  re-invoke with more headroom. It's soft, not a hard cap — sequential mode checks
  between turns, parallel checks at round boundaries (so a round can overshoot),
  and synthesis runs afterward by design.
- Identity and telemetry are returned in `structuredContent`, not embedded in
  answer text.
- Returns the model's text response; on failure returns an MCP error result the
  AI can react to.
- Colored, level-gated logging goes to **stderr** (safe for stdio), with a
  pluggable sink for future DB/API logging.

## Design decisions

- **No provider adapters.** There is no provider-specific code and no built-in
  model list. Legion speaks one wire format; models that don't speak it natively
  go through a gateway. Supporting a new model requires no change here.
- **Models are config, not code.** Adding a model means adding a JSON file. The
  directory is re-read per request, so no rebuild or restart.
- **One tool per model.** Each model appears to the calling AI as its own tool
  with its own description, rather than a single tool with a model parameter.
  The `quorum` tool covers the ad-hoc multi-model case, and each preset in
  `config/presets/` is exposed as its own enforced, pre-staffed council tool.
- **Stateless.** Every call is one-shot with `store: false`. Nothing is
  persisted, so there is no database and no conversation state to manage.
- **Small.** A few hundred lines of TypeScript, one bundled output file, six
  dependencies.

## Requirements

- Node.js 24+
- At least one OpenAI-Responses-compatible endpoint (a provider API directly, or
  a gateway such as LiteLLM for models that need bridging)

## Setup

```pwsh
npm install
copy .env.example .env   # then edit .env
```

## Configuration

All configuration lives in a `config/` directory. The bundled defaults are
**always the base layer**; a `config/` folder in the current working directory
is **overlaid on top of them, per file**:

- **Directory resources** (`models/`, `roles/`, `presets/`, `tools/`): a local
  file overrides the bundled file of the same name; a local-only file is added;
  every bundled file you don't touch stays. So dropping in one
  `config/presets/refine.json` overrides just that preset — the other bundled
  presets remain.
- **Single-file text** (`prompts.json`, `errors.json`, `schema.json`): merged
  **per key** — defaults < bundled < local. A partial local file overrides only
  the keys it sets.
- **`description.md`**: local wins whole if present, else bundled.

The overlay can **override or add**, but not delete a bundled entry. To turn off
bundled presets you don't want, use `DISABLE_PRESETS` (see below).

> **Installing from npm? You must supply your own model files.** The bundled
> config ships only key-free `*.example.json` model files, which the scanner
> deliberately ignores — so the bundle contributes **zero** real models. With no
> real model file the server **fails fast at startup** (`No model files found
> in ...`). Just drop one `config/models/<name>.json` next to where you run the
> server (see below); you no longer need to copy the whole `config/` — the rest
> falls back to the bundled defaults.

The layout below is identical either way, and everything hot-reloads per
request.

### Models — `config/models/*.json`

At least one model file is **required** — the server fails fast without one.
Each JSON file becomes a tool, named after the slugified file name
(`config/models/fable.json` → tool `fable`):

```json
{
   "model": "claude-fable-5",
   "description": "Claude Fable — fast, creative, general purpose.",
   "baseUrl": "https://api.example.com",
   "apiKey": "sk-optional-per-model-key"
}
```

- `model` (required) — the deployed model id the endpoint routes to.
- `description` — helps the calling AI pick the right model.
- `system` — optional baseline system instructions baked into every call to
  this model.
- `baseUrl` / `apiKey` — optional; omitted values fall back to
  `DEFAULT_BASE_URL` / `DEFAULT_API_KEY`.
- `omitParams` — optional list of request params to drop for this model, e.g.
  `["temperature"]`. The server stays provider-agnostic: it never assumes which
  models reject which params — you declare each model's quirks here. Useful for
  reasoning models and some deployments that reject `temperature`.

**Hot-drop:** the directory is re-scanned per request — add or edit a model
file and it's live on the next call, no restart.

**Secrets & git:** model files can contain API keys, so `config/models/*.json`
is git-ignored. Copy a `*.example.json` (tracked, key-free, ignored by the
scanner) to get started:

```pwsh
copy config\models\gpt.example.json config\models\gpt.json   # then add your key
```

### Roles — `config/roles/*.md`

Optional hot-droppable instruction files. Each `.md` file becomes a named role
(slugified from filename). Drop a file, it's live on the next call. This repo
ships `skeptic.md`, `builder.md`, `judge.md`, and `short.md` (a terse "answer
immediately, no deliberation" role useful for constrained-output turns) as
ready-to-use starters — edit or delete them freely (they hold no secrets).

Available selectors in tools become `roleName`, e.g. passing `role: "skeptic"`
or using `"model:skeptic"` in `quorum.models`.

### Presets — `config/presets/*.json`

Optional hot-droppable **council recipes**, one JSON file per preset (named after
the slugified file name, like models). **Each preset becomes its own tool** — drop
`config/presets/code_review.json` and a `code_review` tool appears on the next
request. Each preset has a `description`, a `roles` list, and optional
authoritative `mode` / `synthesizer` defaults. Each role defines its behavior
**inline** — a role's `description` *is* its instructions (the behavior contract);
a role with no `description` falls back to a matching `config/roles/<role>.md`
file:

```json
{
   "description": [
      "Free-for-all: pit several contestants against each other, then crown a winner.",
      "",
      "Staff `contestant` with as many models as you like; one `judge` decides."
   ],
   "mode": "parallel",
   "synthesizer": "judge",
   "roles": [
      { "role": "contestant", "description": "Argue why your answer beats the others.", "min": 2, "max": null },
      { "role": "judge",      "description": "Crown a single winner and justify it.", "min": 1, "max": 1 }
   ]
}
```

The calling AI invokes the preset tool directly (e.g. `code_review`) and still
writes the `models` selectors, assigning any model to any preset role. Presets
are **enforced**: every selector must use a preset role and every role must be
staffed within its cardinality, else the result is an error saying what to fix.

- **`description`** may be a plain string **or an array of strings** (joined with
  newlines) so multi-line prose stays clean without escaping. It is the preset
  tool's own MCP description, so it is **required**.
- **`synthesizer`** (optional) names the role that runs a synthesis turn — it
  must be one of the preset's roles and does **not** speak in normal rounds.
  **`synthesizeEvery`** times it: `"end"` (default), `"round"`, or a number `N`
  (every Nth round, always the last). A preset with a synthesizer needs at least
  one other required role, since the synthesizer is pulled out of the rotation.
- **Cardinality** — each role may set `min` / `max` speakers (default exactly
  one). `max: null` means unbounded; `min: 0` makes a role **optional**
  (staff it or don't). So the battle-royale `combatant` is
  `{ "min": 2, "max": null }`, the shipped `jury` uses `{ "min": 3, "max": 12 }`,
  `workshop`'s `researcher` is `{ "min": 0, "max": 1 }`, and a lone `judge` stays
  `{}`. The same role staffed by several `model:role` selectors is several
  distinct speakers, numbered in the transcript (`juror 1`, `juror 2`).

This repo ships `code_review`, `debate`, `brainstorm`, `quick_take`, `tiebreak`,
`battle_royale`, `jury`, `double_blind` (independent blind panel), `gauntlet`
(private self-refinement race), `refine` (relay polish of an existing artifact),
`workshop` (differentiated creative team), and `focus_group` (moderated panel
that riffs off each other) — edit or delete freely.
Empty/missing folder → no preset tools.

> **Output length is model-driven, not enforced by role text.** A terse role
> nudges but doesn't cap output — use each tool's `maxTokens` for a hard limit.
> Budget generously for reasoning models (thinking tokens count against it) and
> for multi-round quorums (the transcript grows each round, so a ceiling that's
> fine in round 1 can truncate by round 3). The shipped `short` role shows the
> pattern for coaxing brevity: "answer immediately, no deliberation."

### AI guidance — `config/description.md`

Optional markdown served to clients as MCP `instructions` — describe your
models and when the AI should use each. See this repo's copy for a template.

### Tool, field & message text — `config/*.json` and `config/tools/*.md`

All user-facing text lives in config, not code, and hot-reloads per request.
Each file merges over built-in defaults per key, so override only what you want;
open the shipped copies to see the full key set and `{token}` placeholders:

- `config/tools/<tool>.md` — a tool's description (e.g. `quorum.md`). Delete to
  fall back to the built-in string.
- `config/schema.json` — input-field descriptions (`prompt` = shared fields,
  `quorum` = quorum-only; a `quorum` key wins on a name clash).
- `config/prompts.json` — the prompt-shaping templates models read: role
  contract, context block, transcript header, round banners. Tune how strongly
  roles bind and how rounds are framed here.
- `config/errors.json` — runtime error messages shown to the calling AI.

(Startup/config-validation errors stay in code — a message that reports a broken
config file can't live inside it.)

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DEFAULT_BASE_URL` | no* | API root for models without a `baseUrl` — the SDK appends `/responses`. E.g. `https://api.openai.com/v1`, `https://<res>.openai.azure.com/openai/v1`; a LiteLLM proxy works at its plain root. |
| `DEFAULT_API_KEY` | no* | API key for models without an `apiKey`. Stays server-side. |
| `HOST` | no | HTTP bind address (default `127.0.0.1`). Set `0.0.0.0` to expose — then set `ALLOWED_HOSTS`. |
| `ALLOWED_HOSTS` | no | Comma-separated hostnames for DNS-rebinding protection on non-localhost binds. |
| `PORT` | no | HTTP port (default `5000`; ignored by stdio). |
| `MAX_ROUNDS` | no | Max discussion rounds the `quorum` tool accepts (default `5`). |
| `TOKEN_BUDGET` | no | Default **soft** cumulative token budget for a whole `quorum` run (sequential checks between turns, parallel at round boundaries so a round can overshoot; synthesis still runs). Unset = no limit. A per-call `tokenBudget` overrides it. |
| `DYNAMIC_ROLES` | no | Allow the calling AI to define ad-hoc `quorum` roles inline (default `true`). |
| `DISABLE_PRESETS` | no | Comma-separated preset slugs to **not** register as tools (e.g. `battle_royale,jury`). Applies to bundled and local presets alike; unknown names are ignored. Unset = all presets registered. |
| `LOG_LEVEL` | no | `debug` \| `info` \| `warn` \| `error` (default `info`). |

\* Every model must resolve a `baseUrl` and `apiKey` from its file or the
defaults — validated at startup.

The server **fails fast** at startup on a missing/empty models directory,
invalid model files, an unresolvable endpoint or key, or two file names that
slugify to the same tool.

### Routing

Every tool call is a stateless, one-shot Responses API request (`store: false`
— nothing is persisted anywhere). Models whose endpoints natively support the
Responses API (OpenAI, Azure OpenAI / Foundry) set `baseUrl` (and optionally
`apiKey`) to be called **directly**; models that don't (Claude, Gemini, Llama,
…) fall back to the defaults — typically an OpenAI-compatible gateway like
LiteLLM that bridges Responses to their native APIs. Because nothing multi-turn
is used, such a gateway needs **no database** for this workload.

## Logging

- `info` (blue): server start and one metadata line per model call — model,
  latency, token usage, role, context presence. No prompt/response content.
- `debug` (gray): additionally logs the full prompt and response (context is
  noted as present, not printed).
- `warn` (orange) / `error` (red): fallbacks and failures.

Color is auto-disabled when stderr is not a TTY.

## Run

One entrypoint, transport as an argument (`stdio` is the default):

Development (no build step, via `tsx`):

```pwsh
npm run dev        # stdio transport
npm run dev:http   # Streamable HTTP transport on :$PORT/mcp
```

Production (compiled to `bin/server.js`):

```pwsh
npm run build
npm start          # node bin/server.js       (stdio)
npm run start:http # node bin/server.js http
```

## Try it

List the tools with the MCP Inspector:

```pwsh
npx @modelcontextprotocol/inspector npx tsx ts/server.ts
```

## Use in VS Code

Add to your `mcp.json`:

```json
{
   "servers": {
      "legion": {
         "command": "node",
         "args": ["bin/server.js"],
         "cwd": "path/to/legion",
         "env": {
            "DEFAULT_BASE_URL": "https://your-gateway.example.com",
            "DEFAULT_API_KEY": "sk-your-key"
         }
      }
   }
}
```

For the HTTP transport, point your client at `http://<host>:<PORT>/mcp`.

### Health

- `GET /health` — cheap **liveness**: confirms the process is up and config
  loaded. Returns `{ status: "ok", name, version, models }` (a count). Makes no
  external calls. This is what container `HEALTHCHECK`s and Kubernetes
  liveness/readiness probes should hit.
- `GET /health?deep` — optional **connectivity** check: fans a tiny one-token
  prompt to every model and returns a per-model `{ name, model, ok, latencyMs }`
  array. `200` when all reachable, `503` (`status: "degraded"`) if any fail.
  Every model reaching its endpoint counts as reachable — even reasoning models
  that spend the whole budget thinking and emit no text. **Do not** wire this to
  an automatic probe: it makes a real (billable) request per model on every hit,
  and a downstream outage would needlessly restart a perfectly healthy
  container. Use it manually or from a monitoring dashboard.

## Deploy

Ready-to-use container deployment examples (Azure App Service, Azure Container
Apps, Docker Compose, Kubernetes, and Compose + Caddy for HTTPS) live in
[`examples/`](examples/) — each installs Legion from npm and ships a complete
drop-in `config/`.
