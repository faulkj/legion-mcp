# Deployment Examples

Each folder is a standalone deployment example with its own Dockerfile that
installs Legion from npm (`legion-mcp`) and runs the HTTP transport. Pass your
gateway/provider credentials as environment variables at runtime — never bake
secrets into the image or into a committed config file.

## Examples

### [azure-app-service](azure-app-service/)

Azure App Service via `az webapp create` with a custom container. Good when you
want deployment slots, built-in auth, or VNet integration. Binds `0.0.0.0` on
port 8080 (Azure default). Ships a single `gemini` model routed through the
default gateway.

### [azure-container-app](azure-container-app/)

Azure Container Apps via `az containerapp up --source .`. Azure builds the
image, provides HTTPS and a public URL, and scales to zero when idle. Binds
`0.0.0.0` on port 8080 (Azure default). Ships two models (`opus`, `llama`) plus
a `skeptic` role, so the `quorum` tool can fan out with `model:role` selectors.

### [compose](compose/)

Docker Compose with a `.env` file. Copy `.env.example` to `.env`, fill in your
values, then `docker compose up --build`. Good for local development or
single-server deployments. Ships a `gpt` model pointed **directly** at its own
Azure OpenAI endpoint (per-model `baseUrl`, no gateway) and overrides
`description.md` with custom MCP instructions for the calling AI.

### [kubernetes](kubernetes/)

Kubernetes Deployment + Service manifests. Build and push the image to your
registry, create a Secret with your credentials, then `kubectl apply`. Uses
liveness and readiness probes against `/health`. Ships a `mistral` model and
overrides one key in `prompts.json` (`contextBlock`); the other prompt
templates keep their defaults.

Create the Secret the Deployment reads via `envFrom`:

```pwsh
kubectl create secret generic legion-secrets `
   --from-literal=DEFAULT_BASE_URL=https://your-gateway.example.com `
   --from-literal=DEFAULT_API_KEY=sk-your-key
```

### [reverse-proxy](reverse-proxy/)

Compose + Caddy for automatic HTTPS. Caddy handles TLS certificates so MCP
clients can reach Legion over a public HTTPS URL without extra setup. Update
the `Caddyfile` with your domain, copy `.env.example` to `.env` (set
`ALLOWED_HOSTS` to that same domain for DNS-rebinding protection), then
`docker compose up --build`. Ships a `fable` model and overrides one key in
`errors.json` (`modelFailed`).

## Custom Config

Legion's bundled defaults are **always the base layer**; a `config/` folder in
the current working directory is **overlaid on top, per file**. A local file
overrides the bundled file of the same name, a local-only file is added, and
every bundled file you don't touch stays in place. The overlay can override or
add — it can't delete a bundled entry (use `DISABLE_PRESETS` to turn off bundled
presets).

Because the overlay merges, each example ships only the files it actually
customizes. Every example still ships **at least one model file**
(`config/models/<name>.json`) — the bundle contributes zero real models (it
carries only key-free `*.example.json`), so the server fails fast at startup
without one. Everything else (roles, prompts, schema, errors, description,
presets) falls back to the bundled defaults for anything you omit.

The single-file JSON text configs (`prompts.json`, `errors.json`,
`schema.json`) merge **per key** over the built-in defaults, so a partial
`prompts.json` with just one key — as the kubernetes and reverse-proxy examples
show — overrides only that key and leaves the rest alone. Directory resources
(model, role, preset, tool files) merge **per file**: each file is one whole
unit (one tool, one role, one preset).

**Secrets:** the example model files reference `DEFAULT_BASE_URL` /
`DEFAULT_API_KEY` (passed as env vars) rather than embedding a per-model
`apiKey`, so the committed config holds no keys.
