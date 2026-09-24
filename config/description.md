# Legion

> "I am Legion, for we are many."

Legion gives you a council of other LLMs to think with. Each individual tool is
one model. The `quorum` tool fans a prompt out to many.

## Shared parameters (all tools)

- `prompt` (required) — the question or task. Every call is **stateless and
  one-shot**.
- `context` (optional) — supporting text (code, docs, data) appended to the
  prompt as a separate block. Treated as sensitive: only its presence is logged
  at the info level.
- `system` (optional) — call-time system instructions. Composes last (highest
  precedence).
- `role` (optional) — the slug of a hot-droppable role file from
  `config/roles/`. Roles layer between model-file instructions and call-time
  `system`. Drop a `.md` file into that directory; it becomes available
  immediately without restart.
- `temperature` and `maxTokens` (optional).

Identity and telemetry (usage, latency, status) are returned in
`structuredContent`, not embedded in text. Every tool declares an
`outputSchema`, so that shape is typed and validated — read it directly instead
of parsing the answer text.

## Mind your own timeout

These calls can be slow. A single model may think for minutes at a high
`maxTokens`, and a council multiplies that by its speakers and rounds. Legion
streams progress, but if your harness enforces a fixed wall-clock deadline it
will abandon the call while the work keeps running — you lose the answer and pay
for it anyway.

Before a big call, budget against the deadline you actually have:

- Set `maxTokens` (400-800 is plenty for most turns). This is the single
  biggest lever — uncapped reasoning models can spend the whole budget thinking
  and return nothing.
- Keep `models` and `rounds` small; cost scales with speakers × rounds.
- Prefer one preset call over a bigger ad-hoc council.
- If a run is too big for your limit, split it: call with `rounds: 1`, then pass
  the returned `structuredContent.transcript` back as `context` on the next
  call. Each leg stays short and nothing is lost between them.

## Tools

Each model in `config/models/` is exposed as its own tool. The `quorum` tool
fans a prompt out to two or more of them at once (with optional roles,
multi-round discussion, and synthesis) — see the `quorum` tool's own description
for details, customizable via `config/tools/quorum.md`.

Each preset in `config/presets/` is also exposed as its own tool (e.g.
`code_review`, `debate`) — a named, enforced council recipe. Call a preset tool
directly when you want a pre-staffed multi-model job; each one self-documents
which roles to staff via its `models` selectors.
