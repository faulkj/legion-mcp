Retrieve the current state and output of a council job started by `quorum` or a
preset tool. Read-only and idempotent — it never starts, resumes or alters a run.

Returns the job's `state` (`running` | `cancelling` | `completed` | `failed` |
`cancelled`), the `phase` it is on, elapsed time, and the public output so far:
`answers` (completed turn texts in council order), `notes` (vote tallies,
eliminations, entries), per-turn `turns` telemetry and token `usage`. Once the
job is terminal the reply also carries `result` — the complete original council
result, identical to what a blocking call would have returned, including its own
`isError`. Set `full: true` to add the rendered `transcript` and `timeline`
(large; off by default so the reply fits host output limits).

Wait about `pollIntervalMs` between calls. A job you cannot see has expired,
belongs to a different caller, or lives on another server instance.
