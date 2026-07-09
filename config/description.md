# Legion

> "I am Legion, for we are many."

Legion gives you a council of other LLMs to think with. Each individual tool is one model. The `quorum` tool fans a prompt out to many.

## Shared parameters (all tools)

- `prompt` (required) — the question or task. Every call is **stateless and one-shot**.
- `context` (optional) — supporting text (code, docs, data) appended to the prompt as a separate block. Treated as sensitive: only its presence is logged at the info level.
- `system` (optional) — call-time system instructions. Composes last (highest precedence).
- `role` (optional) — the slug of a hot-droppable role file from `config/roles/`. Roles layer between model-file instructions and call-time `system`. Drop a `.md` file into that directory; it becomes available immediately without restart.
- `temperature` and `maxTokens` (optional).

Identity and telemetry (usage, latency, status) are returned in `structuredContent`, not embedded in text.

## Tools

Each model in `config/models/` is exposed as its own tool. The `quorum` tool fans a prompt out to two or more of them at once (with optional roles, multi-round discussion, and synthesis) — see the `quorum` tool's own description for details, customizable via `config/tools/quorum.md`.

