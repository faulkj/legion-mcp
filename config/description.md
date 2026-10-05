# Legion

> "I am Legion, for we are many."

Legion gives you a council of other LLMs to think with. Each individual tool is
one model. The `quorum` tool fans a prompt out to many.

## Shared parameters (model, quorum and preset tools)

- `prompt` (required) — the question or task. Every council call is a **new
  run**: feeding a transcript back as `context` carries the discussion, not the
  run's field, round or budget state.
- `context` (optional) — supporting text (code, docs, data) appended to the
  prompt as a separate block. Treated as sensitive: only its presence is logged
  at the info level.
- `system` (optional) — call-time system instructions, composed over the model
  file's own `system`.
- `temperature` and `maxTokens` (optional).

## Model tools only

- `role` (optional) — the slug of a hot-droppable role file from
  `config/roles/`. Instructions compose model file → call-time `system` → role
  contract, so the role binds last. Drop a `.md` file into that directory and it
  becomes available without a rebuild. The `quorum` and preset tools take no
  `role`; they assign roles per seat via `models` selectors instead.

Identity and telemetry (usage, latency, status) are returned in
`structuredContent`, not embedded in text. Every tool declares an
`outputSchema`, so that shape is typed and validated — read it directly instead
of parsing the answer text.

{longRuns}

Whatever the mode, `maxTokens` (400-800 for most turns) is the biggest cost
lever — uncapped reasoning models can spend the whole budget thinking and return
nothing. Some preset roles set their own ceiling, which overrides yours for that
seat. Cost scales with speakers × rounds.

## Tools

Each model in `config/models/` is exposed as its own tool. The `quorum` tool
fans a prompt out to two or more of them at once (with optional roles,
multi-round discussion, and synthesis) — see the `quorum` tool's own description
for details, customizable via `config/tools/quorum.md`.

Each preset in `config/presets/` is also exposed as its own tool (e.g.
`code_review`, `debate`) — a named, enforced council recipe. Call a preset tool
directly when you want a pre-staffed multi-model job; each one self-documents
which roles to staff via its `models` selectors.
