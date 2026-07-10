import { fill } from '../config/config.js'
import { log } from '../core/log.js'
import { everyN } from './context.js'

/** Whether an elimination is due this round: a positive `eliminateEvery` cadence, hit on its interval (including the final round). */
export const eliminationDue = (eliminateEvery: number | undefined, round: number): boolean => {
   const interval = everyN(eliminateEvery)
   return interval !== Infinity && round % interval === 0
}

/** Whether a frame is due this round: always the opening (round 1), then every `reframeEvery` rounds after it (so N=2 → rounds 1, 3, 5…). */
export const frameDue = (reframeEvery: SynthesizeEvery | undefined, round: number): boolean => {
   const interval = everyN(reframeEvery)
   return round === 1 || (interval !== Infinity && (round - 1) % interval === 0)
}

/** Build the framer step: a neutral voice sets the stakes on the opening round and re-steers on later fires. Recorded as content (phase 'frame') so the field reacts to it. */
export const makeFramer = (deps: PhaseDeps): ((round: number) => Promise<void>) => {
   const { frame, full, speakOne, record, templates } = deps
   return async (round: number): Promise<void> => {
      if (frame === undefined) return
      record(await speakOne(frame, round, 'frame', full(), (round === 1 ? templates.frame : templates.reframe)), round)
   }
}

/** Build the synthesis step: the synthesizer consolidates the whole transcript into one answer (an interim answer on round > 0, the final one on round 0). */
export const makeSynthesizer = (deps: PhaseDeps): ((round: number) => Promise<void>) => {
   const { synth, synthSelector, templates, errors, full, telemetry, speakOne, record } = deps
   return async (round: number): Promise<void> => {
      if (synthSelector === undefined) return
      if (synth === undefined) {
         telemetry.push({ index: -1, selector: synthSelector, modelName: '', modelId: '', round, phase: 'synthesis', usage: {}, latencyMs: 0, status: errors.unresolvableSelector })
         return
      }
      record(await speakOne(synth, round, 'synthesis', full()), round)
      telemetry[telemetry.length - 1]?.status.includes('reasoning-heavy') &&
         log('warn', `⚠️ synthesis (${synthSelector}) spent most of its budget reasoning — raise maxTokens or use a lighter model for synthesize`)
   }
}

/**
 * Build the elimination step. Each call has the synthesizer read the transcript and pick one live
 * speaker to remove via a numbered menu; the pick is dropped from `live` (never prompted again, so
 * it costs nothing after its cut) and the decision is recorded as a transcript note, not answer
 * content. When `optional`, the synthesizer may decline; an unparseable reply removes no one.
 */
export const makeEliminator = (deps: PhaseDeps): ((round: number) => Promise<void>) => {
   const { synth, labels, optional, templates, live, liveSpeakers, full, speakOne, note } = deps
   return async (round: number): Promise<void> => {
      const candidates = liveSpeakers()
      if (synth === undefined || candidates.length < 2) return
      const
         menu = eliminationMenu(candidates, labels, optional),
         { text, entry } = await speakOne(synth, round, 'elimination', full(), fill(templates.elimination, { menu })),
         pick = text === null ? null : parseElimination(text, candidates, optional),
         cut = pick === 'none' ? null : pick,
         status = cut
            ? `eliminated: ${labels[cut.index]}`
            : pick === 'none'
               ? 'no elimination'
               : 'invalid decision'
      if (cut) live.delete(cut.index)
      note(
         { index: cut ? cut.index : synth.index, selector: synth.selector, round, phase: 'elimination', text: cut ? `${labels[cut.index]} eliminated` : 'no elimination' },
         { ...entry, phase: 'elimination', status, eliminatedIndex: cut ? cut.index : undefined }
      )
   }
}

/** Numbered candidate menu shown to the synthesizer, one live speaker per line (`1) critic 1`); when `optional`, a leading `0) no elimination` lets it keep everyone. */
const eliminationMenu = (candidates: Speaker[], labels: string[], optional: boolean): string => {
   const rows = candidates.map((s, i) => `${i + 1}) ${labels[s.index] ?? s.selector}`)
   return optional ? ['0) no elimination', ...rows].join('\n') : rows.join('\n')
}

const parseElimination = (reply: string, candidates: Speaker[], optional: boolean): Speaker | 'none' | null => {
   const match = reply.match(/\d+/)
   if (!match) return null
   const pick = Number(match[0])
   return optional && pick === 0
      ? 'none'
      : pick >= 1 && pick <= candidates.length
         ? candidates[pick - 1]!
         : null
}
