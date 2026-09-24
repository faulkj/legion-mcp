/**
 * Project a run's telemetry into an ordered, flattened event log for the calling model — one entry
 * per turn (frame, round, entry, closing, vote, synthesis, elimination) in the order it happened.
 * A pure read over telemetry the run already built, so it never touches the deliberation loop.
 * `round: 0` marks the end-of-run synthesis; a vote or synthesis note carries `index: -1` (no seat).
 */
export const buildTimeline = (telemetry: TurnTelemetry[], labels: string[]): TimelineEvent[] =>
   telemetry.map(t => {
      const
         who = t.index >= 0 ? labels[t.index] ?? t.selector : undefined,
         base: TimelineEvent = { round: t.round, phase: t.phase, ...(who ? { who } : {}) },
         detail = detailFor(t, labels)
      return detail ? { ...base, detail } : base
   })

const detailFor = (t: TurnTelemetry, labels: string[]): string | undefined =>
   t.phase === 'elimination'
      ? t.eliminatedIndex === undefined ? 'no elimination' : `eliminated ${labels[t.eliminatedIndex] ?? t.eliminatedIndex}`
      : t.phase === 'vote'
         ? t.status.replace(/^vote tallied: /, '')
         : t.status.startsWith('error') || t.status.startsWith('skipped')
            ? t.status
            : undefined
