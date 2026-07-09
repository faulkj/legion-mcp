Fan a prompt out to two or more models; each answer comes back as a separate content item.

```
models  — array of selectors: "modelSlug" or "modelSlug:roleSlug" (min 2)
roles   — optional ad-hoc roles for this call: { "name": "instructions" }
rounds  — discussion rounds (default 1; max set by MAX_ROUNDS)
mode    — "sequential" (default) or "parallel"
synthesize — selector for a final synthesis turn after all rounds
tokenBudget — optional soft cumulative token budget (overrides TOKEN_BUDGET)
```

**Selectors**: `"fable"`, `"opus:skeptic"`, `"gpt:builder"`. Same model + different roles = distinct speakers (`["gpt:judge", "gpt:skeptic"]`); identical selectors dedupe.

**Modes**: *sequential* (default) — speakers take turns, each seeing the transcript so far (a real back-and-forth). *parallel* — all answer at once per round; with `rounds > 1` each round reacts to the previous round's snapshot.

**Ad-hoc roles**: define personas inline for one call — `roles: { "contrarian": "Argue against every claim." }`, then `models: ["gpt:contrarian", "fable"]`. Shadows a file role of the same name; disabled when `DYNAMIC_ROLES=false`.

**Presets**: named council recipes are exposed as their own tools (e.g. `code_review`, `debate`) — call those directly instead of `quorum` when you want an enforced, pre-staffed council. Each preset tool self-documents which roles to staff via `models` selectors.

**You are the moderator** (the server is stateless — you hold the thread): call with `rounds: 1`, read `structuredContent.transcript`, then call again with `context` = that transcript + your steering; finish with `synthesize`. Feed `transcript` straight back as `context` — don't add your own `[round N / …]` labels; the tool owns that structure.

**Results**: text answers arrive in council (selector) order; per-turn telemetry (usage, latency, `status`, role, `contentIndex`) is in `structuredContent.turns`. `status` ∈ `ok` · `truncated` (hit `maxTokens`, partial text returned) · `reasoning-heavy` (spent most of the budget thinking — answer may be thin; may combine, e.g. `truncated, reasoning-heavy`) · `skipped: budget` · `error: <message>`. `isError: true` only when **all** turns fail; partial success returns what succeeded. Empty responses retry once before erroring.

**Budget** is soft: checked between turns (sequential) or at round boundaries (parallel — a round can overshoot); synthesis always runs. `structuredContent.budget` = `{ limit, used, exceeded }`.

Roles/presets apply **pressure, not guaranteed output control** — for a hard length cap use `maxTokens`; trust `structuredContent.turns` for what actually happened.
