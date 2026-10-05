Ask a running council job to stop, and get back whatever it has produced so far.

Cancellation is cooperative: in-flight model calls are aborted, no new turns
start, and the reply returns at once with the current public snapshot (same
shape as `poll`) in state `cancelling`. Turns that were already finishing may
still land; `poll` afterwards to see the settled `cancelled` result, which is
marked `isError: true` and carries no synthesis. Repeating `cancel` is harmless.
Cancelling a job that already finished returns its existing result unchanged.

Provider-side generation that has already started may still be billed.
