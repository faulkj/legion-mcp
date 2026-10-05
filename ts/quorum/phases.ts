import { fill, slugify } from '../config/config.js'
import { log } from '../core/log.js'
import { everyN } from './context.js'
import { eliminationMenu, eliminationReason, parseElimination } from './elimination.js'

/**
 * Whether an elimination is due this round. A number N cuts every Nth round. `'spread'` distributes the
 * `field - 1` cuts needed to reach one survivor evenly across `rounds`, so the last cut lands on the
 * final round and a 5-round match with 3 survivors cuts after rounds 3 and 5 instead of 1 and 2.
 */
export const eliminationDue = (eliminateEvery: EliminateEvery | undefined, round: number, rounds: number, field: number): boolean => {
   if (eliminateEvery === 'spread') {
      const cuts = Math.max(0, field - 1)
      return cuts > 0 && Math.floor(round * cuts / rounds) > Math.floor((round - 1) * cuts / rounds)
   }
   const interval = everyN(eliminateEvery)
   return interval !== Infinity && round % interval === 0
}

/**
 * Survivor mode must crown a single winner. If the round cap runs out (or a cut comes back invalid)
 * with the field still crowded, keep eliminating until one remains — bounded by the starting field
 * size. A cut that removes no one is retried once (reasoning models can blow their budget on a
 * single call); two misses in a row ends the chase so a synthesizer that never cuts can't loop.
 */
export const chaseToOne = async (eliminateEvery: EliminateEvery | undefined, rounds: number, regulars: () => Speaker[], runElimination: (round: number) => Promise<void>, report: ReportPhase): Promise<void> => {
   if (eliminateEvery === undefined || eliminateEvery === 0) return
   let misses = 0
   for (let extra = regulars().length; regulars().length > 1 && extra > 0; extra--) {
      const before = regulars().length
      await report(`elimination after round ${rounds} — ${before} left${misses ? ' (retry)' : ''}`), await runElimination(rounds)
      if (regulars().length < before) misses = 0
      else if (++misses > 1) return
      else extra++
   }
}

/** Whether a frame is due this round: always the opening (round 1), then every `reframeEvery` rounds after it (so N=2 → rounds 1, 3, 5…). */
export const frameDue = (reframeEvery: SynthesizeEvery | undefined, round: number): boolean => {
   const interval = everyN(reframeEvery)
   return round === 1 || (interval !== Infinity && (round - 1) % interval === 0)
}

/** Build the framer step: a neutral voice sets the stakes on the opening round and re-steers on later fires. Recorded as content (phase 'frame') so the field reacts to it. */
export const makeFramer = (deps: PhaseDeps): ((round: number) => Promise<void>) => {
   const { frame, prompt, full, speakOne, record, templates } = deps
   return async (round: number): Promise<void> => {
      if (frame === undefined) return
      record(await speakOne(frame, round, 'frame', full(), (round === 1 ? templates.frame : templates.reframe) + prompt), round)
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

/** Build the closing phase: one marked closer per team or unteamed role speaks in parallel, then `closingLast` roles respond in sequence. */
export const makeCloser = (deps: ClosingDeps): (() => Promise<void>) => {
   const
      { roles, rounds, budgetOk, speakers, context, runParallel, speakOne, record, skip } = deps,
      marked = (key: 'closing' | 'closingLast'): Set<string> => new Set(roles.filter(r => r[key]).map(r => slugify(r.role))),
      closingRoles = marked('closing'),
      finalRoles = marked('closingLast'),
      selected = (): Speaker[] => {
         if (!closingRoles.size) return speakers()
         const groups = new Set<string>()
         return speakers().filter(s => {
            if (s.role === undefined || !closingRoles.has(s.role)) return false
            const group = s.team === undefined ? `role:${s.role}` : `team:${s.team}`
            return !groups.has(group) && (groups.add(group), true)
         })
      }
   return async (): Promise<void> => {
      const closers = selected()
      if (!budgetOk()) { skip(rounds + 1, 0, 'closing', closers); return }
      const final = closers.filter(s => s.role !== undefined && finalRoles.has(s.role))
      await runParallel(closers.filter(s => !final.includes(s)), rounds + 1, 'closing', context)
      for (const speaker of final)
         record(await speakOne(speaker, rounds + 1, 'closing', context(speaker)), rounds + 1)
   }
}

/** Build the elimination step: the synthesizer selects an exact live label to drop, recorded as a transcript note. `optional` permits a pass; malformed or ambiguous commands cut no one. */
export const makeEliminator = (deps: PhaseDeps): ((round: number) => Promise<void>) => {
   const { synth, labels, optional, templates, live, liveSpeakers, full, telemetry, speakOne, note } = deps
   return async (round: number): Promise<void> => {
      const candidates = liveSpeakers()
      if (synth === undefined || candidates.length < 2) return
      const { text, entry, cancelled } = await speakOne(synth, round, 'elimination', full(), fill(templates.elimination, { menu: eliminationMenu(candidates, labels, optional) }))
      if (cancelled || deps.cancelled()) { telemetry.push({ ...entry, phase: 'elimination', status: 'cancelled' }); return }
      const
         pick = text === null ? null : parseElimination(text, candidates, labels, optional),
         cut = pick === 'none' ? null : pick,
         why = text === null ? '' : eliminationReason(text),
         tail = why ? ` — ${why}` : '',
         status = cut ? `eliminated: ${labels[cut.index]}` : pick === 'none' ? 'no elimination' : 'invalid decision'
      if (cut) live.delete(cut.index)
      note(
         { index: cut ? cut.index : synth.index, selector: synth.selector, round, phase: 'elimination', text: (cut ? `${labels[cut.index]} eliminated` : 'no elimination') + tail },
         { ...entry, phase: 'elimination', status: status + tail, eliminatedIndex: cut ? cut.index : undefined }
      )
   }
}
