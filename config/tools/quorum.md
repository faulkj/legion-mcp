Fan a prompt out to two or more models; each answer comes back as a separate content item.

```
models  — array of selectors: "modelSlug" or "modelSlug:roleSlug" (min 2)
roles   — optional ad-hoc roles for this call: { "name": "instructions" }
rounds  — discussion rounds (default 1; max set by MAX_ROUNDS)
mode    — "sequential" (default) | "parallel" | "private" | "independent"
synthesize — selector for a synthesis turn (never speaks in normal rounds)
synthesizeEvery — N: every Nth round (1 = every round, 0 = end only); "end"=0 default; needs synthesize
tokenBudget — optional soft cumulative token budget (overrides TOKEN_BUDGET)
```

**Selectors**: `"fable"`, `"opus:skeptic"`, `"gpt:builder"`. Same model + different roles = distinct speakers (`["gpt:judge", "gpt:skeptic"]`). Identical selectors are **not** deduped — `["gpt:critic", "gpt:critic"]` runs two independent critics (labeled `critic 1`/`critic 2`), at ~2× the tokens.

**Modes** (a 2×2 of *see peers?* × *see own prior turns?*): *sequential* (default) — each turn sees the full transcript so far, including same-round peers. *parallel* — sees only completed earlier rounds, blind to same-round peers. *private* — sees only its own prior turns (blind self-refinement across rounds). *independent* — sees nothing but the prompt during rounds; a true blind panel. All modes' synthesis still sees the whole transcript.

**Synthesizer**: `synthesize` names a final consolidating voice that does **not** speak in normal rounds — it runs only in its synthesis slot. `synthesizeEvery` controls timing: a number `N` runs synthesis every Nth round (feeding forward, always including the last; `1` = every round, `0` = end only). `end` is an alias for `0` and is the default. Interim per-round syntheses get an interim banner, not the "final" one.

**Transcript labels**: turns are labeled by **role** (`builder`, `critic 1`, `critic 2`), never by model — so models judge each other's content, not reputation. Role-less selectors show the model slug. `structuredContent.turns` still reports real selectors for you.

**Ad-hoc roles**: define personas inline for one call — `roles: { "contrarian": "Argue against every claim." }`, then `models: ["gpt:contrarian", "fable"]`. Shadows a file role of the same name; disabled when `DYNAMIC_ROLES=false`.

**Presets**: named council recipes are exposed as their own tools (e.g. `code_review`, `debate`) — call those directly instead of `quorum` when you want an enforced, pre-staffed council. Each preset tool self-documents which roles to staff via `models` selectors.

**You are the moderator** (the server is stateless — you hold the thread): call with `rounds: 1`, read `structuredContent.transcript`, then call again with `context` = that transcript + your steering; finish with `synthesize`. Feed `transcript` straight back as `context` — don't add your own `[round N / …]` labels; the tool owns that structure.

**Results**: text answers arrive in council (selector) order; per-turn telemetry (usage, latency, `status`, role, `contentIndex`) is in `structuredContent.turns`. `status` ∈ `ok` · `truncated` (hit `maxTokens`, partial text returned) · `reasoning-heavy` (spent most of the budget thinking — answer may be thin; may combine, e.g. `truncated, reasoning-heavy`) · `skipped: budget` · `error: <message>`. `isError: true` only when **all** turns fail; partial success returns what succeeded. Empty responses retry once before erroring.

**Budget** is soft: checked between turns (sequential) or at round boundaries (parallel — a round can overshoot); synthesis always runs. `structuredContent.budget` = `{ limit, used, exceeded }`.

Roles/presets apply **pressure, not guaranteed output control** — for a hard length cap use `maxTokens`; trust `structuredContent.turns` for what actually happened.
