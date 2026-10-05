import { toContext } from './context.js'
import { buildTimeline } from './timeline.js'

/**
 * Project a copied, public view of a run in progress from the live engine. Committed answers
 * come from `content`; `pending` adds parallel turns that have finished but not yet committed
 * (shown as answers, never assigned a contentIndex). Telemetry already carries only sanitized
 * statuses, so copying it leaks nothing a final result would not. `full` adds the rendered
 * transcript and timeline, which can be large.
 */
export const snapshotRun = (runner: TurnRunner, labels: string[], templates: PromptTemplates, full: boolean): RunSnapshot => {
   const
      { telemetry, turns, content, pending, inFlight, used, phase } = runner,
      now = Date.now(),
      answers = [
         ...content.map(c => c.text),
         ...pending.map(p => p.text)
      ],
      notes = turns.filter(t => t.phase === 'vote' || t.phase === 'elimination' || t.phase === 'entry').map(t => t.text)
   return {
      phase: phase(),
      answers,
      notes,
      turns: telemetry.map(t => ({ ...t, usage: { ...t.usage } })),
      waitingOn: inFlight.map(s => ({ who: labels[s.index] ?? s.selector, phase: s.phase, round: s.round, elapsedMs: now - s.startedAt })),
      usage: used(),
      ...(full
         ? {
            transcript: toContext([...turns, ...pending], labels, templates) ?? '',
            timeline: buildTimeline(telemetry, labels)
         }
         : {})
   }
}
