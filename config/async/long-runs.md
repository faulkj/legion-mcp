## Councils run in the background — start, poll, cancel

The `quorum` and preset tools return **immediately** with a job handle
(`structuredContent.jobId`) instead of blocking for minutes. The council keeps
running on the server.

1. **Start once.** Call the council tool. Keep the `jobId`. Do not start a second
   council for the same question — if you are unsure whether a start succeeded,
   `poll` first.
2. **Poll.** Call `poll` with the `jobId` about every `pollIntervalMs`
   milliseconds (returned in the handle). Each reply carries `state`, `phase`,
   and the answers completed so far — partial results you can read while
   waiting. `poll` never starts a run and is safe to repeat.
3. **Finish.** When `state` is `completed`, `failed` or `cancelled`, the reply
   includes `result` — the full council output in its usual shape (`content`,
   `structuredContent.turns/timeline/transcript`, `isError`). A `completed` job
   can still have `result.isError: true` (e.g. the synthesis failed); read it
   the same way you would a blocking call. Pass `full: true` to also get the
   rendered transcript and timeline in the poll reply.
4. **Cancel** abandoned work with `cancel`. It returns whatever had completed,
   marked incomplete; no synthesis is run on a cancelled council.

Finished jobs are kept for a limited time (`expiresAt`) and live only in server
memory — a server restart loses them. Individual model tools are unchanged:
they still answer in the same call.
