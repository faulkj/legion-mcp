Fan a prompt out to two or more models and get every answer back as a separate content item.

```
models  — array of selectors: "modelSlug" or "modelSlug:roleSlug"
roles   — optional ad-hoc roles for this call: { "name": "instructions" }
rounds  — discussion rounds (default 1; max set by MAX_ROUNDS, default 5)
mode    — "sequential" (default) or "parallel"
synthesize — selector for a final synthesis turn after all rounds complete
tokenBudget — optional SOFT cumulative token budget for the whole run (overrides TOKEN_BUDGET)
preset  — optional named council recipe (config/presets.json); defines + enforces the roles, may fix mode/synthesize
```

**Sequential** (default): speakers take turns in the order given. Each speaker receives the full accumulated transcript so far as context — a real back-and-forth. Reorder the `models` array to change who opens or closes.

**Parallel**: all speakers answer at once per round. With `rounds > 1`, each round reacts to the previous round's snapshot.

**Round awareness**: in a multi-round debate each speaker is told its position (e.g. `[Round 2 of 3]`) so it knows whether to keep exploring or converge; the final round and the synthesis turn get explicit "commit" cues. This orientation is added to the speaker's prompt only — the returned `transcript` stays clean.

**Selector syntax**: `"fable"`, `"opus:skeptic"`, `"gpt:builder"`. The **same model with different roles counts as distinct speakers** — `["gpt:judge", "gpt:skeptic"]` runs one model twice with two personas. Identical selectors (`["gpt:judge", "gpt:judge"]`) dedupe to a single speaker.

**Ad-hoc roles**: define personas inline for a single call without adding files:

```
roles:  { "contrarian": "Argue against every claim; find the weakest link." }
models: ["gpt:contrarian", "fable"]
```

File roles in `config/roles/` are always available too; an ad-hoc role **shadows** a file role of the same name for that call only. Ad-hoc roles are disabled when `DYNAMIC_ROLES=false` (using `roles` then returns `isError`).

**You are the moderator.** The server is stateless — you hold the thread. To run a live, steered debate:

1. Call quorum with `rounds: 1`. Read the answers plus `structuredContent.transcript`.
2. Steer: call again with `context` = that transcript + your guidance (or run a single-model tool as a moderator turn).
3. Repeat as long as it's useful; finish with `synthesize`.

**Synthesis**: after the final round, the named selector reads the whole transcript and returns a final take. A failed synthesis still returns the discussion turns.

Per-turn telemetry (usage, latency, status, role) is in `structuredContent.turns`; the full discussion text is in `structuredContent.transcript` — feed it straight back as `context`.

**Transcript structure is owned by the moderator, not the speakers.** The `[round N / speaker]` labels are added when building the transcript; each model's answer is stored raw. Speakers are instructed not to label their own turns — so if you author your own steering turns between calls, don't add `[round N / …]` prefixes either; let the structure come from the tool.

A failed call returns `isError: true` only when **all** calls failed. Partial success returns the successful content items with failures recorded in `structuredContent.turns`.

**Token budget (soft)**: set `tokenBudget` (or the `TOKEN_BUDGET` default) as a **soft** cumulative budget for the run — not a hard cap. The running total is checked **between turns**, so a parallel round can overshoot before the server notices, and synthesis runs afterward by design. Once the total crosses the budget, remaining turns are skipped (recorded as `skipped: budget` in `structuredContent.turns`), and `structuredContent.budget` reports `{ limit, used, exceeded }`. Read it to see what was dropped, then re-invoke with a higher budget if you want the rest.

**Presets (council recipes)**: `preset` names a recipe from `config/presets.json` — a self-contained council. Each preset defines its own roles inline (a role's description IS its behavior contract; a role with no description falls back to a `config/roles/<role>.md` file). You still write the `models` selectors and freely assign any model to any preset role (a model may play several).

When a preset is set it is **enforced**: every selector must use one of the preset's roles, and every preset role must be staffed by at least one selector — otherwise the call returns `isError` explaining what to fix (e.g. add a `model:<role>` selector). A preset can also carry **authoritative** `mode` and `synthesize` defaults: when present they win, and any `mode`/`synthesize` you pass is ignored. A preset's `synthesize` names a role — the first selector staffing that role runs the synthesis turn (so staff it). The chosen preset is echoed in `structuredContent.preset`, so you can re-run the same recipe with new `context` across turns. Want to freestyle? Just omit `preset`.

**Per-turn `status` values** (in `structuredContent.turns`):

| `status` | Meaning | Has content? |
| --- | --- | --- |
| `ok` | Completed normally. | yes (`contentIndex` set) |
| `truncated` | Hit `maxTokens` but produced usable text. | yes |
| `reasoning-heavy` | Successful content — but the model spent at least as many tokens reasoning as it emitted as visible text, so the budget went mostly to thinking. The answer may be thin. Can combine, e.g. `truncated, reasoning-heavy`. | yes (`contentIndex` set) |
| `error: <message>` | The call failed; no content item was added. | no |

`reasoning-heavy` is a **quality hint, not a failure** — the turn still returns its text and a `contentIndex`. It matters most for **synthesis**: a reasoning model asked to consolidate a long transcript can burn the budget thinking and return a stub. If a `synthesize` turn comes back thin, raise `maxTokens` or point `synthesize` at a non-reasoning / low-reasoning model. (The server also logs a warning when a synthesis turn is reasoning-heavy.)

An empty (no-text) response is **retried once automatically** before it becomes an `error` — this absorbs the transient "no output" blips models occasionally return under concurrent load. A genuine ceiling problem simply fails again on the retry.

### Tuning `maxTokens`

Each turn's input includes the whole discussion so far, so **context grows every round** — and reasoning models spend hidden tokens on top of visible output. A ceiling that's comfortable in round 1 often truncates by round 3. Rules of thumb:

- Single-round / short answers: `maxTokens: 500` is usually fine.
- Multi-round debates: budget higher (e.g. `1500`–`4000`) so later turns aren't clipped as the transcript grows.
- Reasoning models: add headroom beyond the visible length you want, since thinking tokens count against the ceiling.
- Truncation isn't fatal — a `truncated` turn still returns its partial text — but raising `maxTokens` gives fuller answers.

**Terse roles / tight output**: reasoning models sometimes deliberate away the whole budget when a role asks for very short answers, especially in parallel bursts. Tell the role to skip deliberation — the shipped `short` role (`config/roles/short.md`) does exactly this: "Answer immediately … no preamble, no deliberation." Add a similar line to any terse persona.
