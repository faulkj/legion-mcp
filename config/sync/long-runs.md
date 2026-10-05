## Mind your own timeout

Council calls block until the run finishes. A single model may think for
minutes at a high `maxTokens`, and a council multiplies that by its speakers and
rounds. Legion streams progress, but if your harness enforces a fixed wall-clock
deadline it will abandon the call while the work keeps running — you lose the
answer and pay for it anyway. Dropping the connection cancels the run.

Before a big call, budget against the deadline you actually have:

- Keep `models` and `rounds` small.
- Prefer one preset call over a bigger ad-hoc council.
- If a run is too big for your limit, split it: call with `rounds: 1`, then pass
  the returned `structuredContent.transcript` back as `context` on the next
  call. Each leg stays short; the next leg is a new run that reads the prior
  discussion.
