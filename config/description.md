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

Whatever the mode, `maxTokens` is the biggest cost lever and it is **per turn**.
It caps the **visible** answer; reasoning models get their own hidden-thinking
allotment on top (set per model, 500-3000), so you never need to pad it for
thinking. The maximum is `MAX_TOKENS` (default 3000); larger values are
rejected. Omitted, every seat runs at its preset role's limit or that
ceiling. **Use about 1500** — it is enough for almost every council turn, keeps the
growing transcript (and so every later turn's input) small, and makes speakers
get to the point. Go higher only for long-form deliverables; plain chat models
are fine at 800-1500.

`tokenBudget` is the other axis and counts **input and output of every call**.
Never set a small `tokenBudget` without also setting `maxTokens` — the default
per-turn ceilings will burn through it in a round or two and the rest of the run
is skipped. Size it as `turns × (context + maxTokens + reasoning allotment)`
where context grows each round; for a multi-round council that is usually 150k+.
Cost scales with speakers × rounds.

## Tools

Each model in `config/models/` is exposed as its own tool. The `quorum` tool
fans a prompt out to two or more of them at once (with optional roles,
multi-round discussion, and synthesis) — see the `quorum` tool's own description
for details, customizable via `config/tools/quorum.md`.

Each preset in `config/presets/` is also exposed as its own tool (e.g.
`code_review`, `debate`) — a named, enforced council recipe. Call a preset tool
directly when you want a pre-staffed multi-model job; each one self-documents
which roles to staff via its `models` selectors.
