import { fill, slugify } from '../config/config.js'
import { log } from '../core/log.js'
import { makeSeen, toContext } from './context.js'
import { entrantFirst, entryDue, makeEntry, nextEntrant, objectiveError, recordEntry, rotateTeams, withObjective } from './entry.js'
import { eliminationDue, frameDue, makeCloser, makeEliminator, makeFramer, makeSynthesizer } from './phases.js'
import { presetError, resolveSpeakers, validatePreset } from './helpers.js'
import { makeTurnRunner } from './runner.js'
import { resolveConfig } from './setup.js'
import { makeVoter } from './voting.js'

export const runQuorum = async (
   args: QuorumInput,
   models: ModelDef[],
   roles: RoleDef[],
   prompt: Prompt,
   maxRounds: number,
   dynamicRoles: boolean,
   templates: PromptTemplates,
   errors: ErrorMessages,
   tokenBudget?: number,
   presets: Presets = {}
): Promise<{ content: { type: 'text'; text: string }[]; structuredContent?: unknown; isError: boolean }> => {
   const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

   if (args.roles && Object.keys(args.roles).length && !dynamicRoles)
      return err(errors.adhocDisabled)

   const
      { preset, effectiveRoles, adHocEmpty, rounds, mode, synthSelector, synthInterval, frameSelector, reframeEvery, closing, eliminateEvery, enterEvery, optional, silentRoles, error } = resolveConfig(args, models, roles, presets, maxRounds)
   if (adHocEmpty) return err(errors.adhocEmptyName)
   if (error) return err(errors[error])

   const presetFailure = args.preset === undefined ? null : presetError(validatePreset(args.preset, args.models, presets, models, roles), args.preset, presets, errors)
   if (presetFailure) return err(presetFailure)

   const { speakers, roundSpeakers, synth, frame, labels, bad } = resolveSpeakers(args.models, synthSelector, models, effectiveRoles, frameSelector, silentRoles)
   if (bad) return err(fill(errors.unknownSelector, { selector: bad }))
   if (synth?.team !== undefined) return err(errors.synthTeamed)
   if (frame?.team !== undefined) return err(errors.frameTeamed)
   const unteamedCandidate = preset?.voteByTeam ? roundSpeakers.find(s => s.team === undefined && preset.roles.some(r => r.candidate && slugify(r.role) === s.role)) : undefined
   if (unteamedCandidate) return err(`Selector "${unteamedCandidate.selector}" must use an @team tag for team voting.`)
   const unteamedTag = roundSpeakers.find(s => s.team === undefined && preset?.roles.some(r => r.tagTeam && slugify(r.role) === s.role))
   if (unteamedTag) return err(`Selector "${unteamedTag.selector}" must use an @team tag for tag-team rounds.`)
   const setupErr = objectiveError(roundSpeakers, args.objectives)
   if (setupErr) return err(setupErr)

   const
      { telemetry, turns, content, used, speakOne, record, note, skip, runParallel, runHidden } = makeTurnRunner(args, effectiveRoles, roundSpeakers, rounds, prompt, templates),
      // `live` shrinks on elimination, `entered` grows on entry; effective = entered AND live (one seam rounds + eliminator read).
      live = new Set(roundSpeakers.map(s => s.index)),
      entry = makeEntry(roundSpeakers, enterEvery),
      markedRoles = (key: 'voter' | 'candidate' | 'tagTeam'): Set<string> => new Set((preset?.roles ?? []).filter(r => r[key]).map(r => slugify(r.role))),
      voterRoles = markedRoles('voter'),
      candidateRoles = markedRoles('candidate'),
      tagTeamRoles = markedRoles('tagTeam'),
      hasRole = (s: Speaker, marked: Set<string>): boolean => !marked.size || s.role !== undefined && marked.has(s.role),
      field = (): Speaker[] => roundSpeakers.filter(s => entry.entered.has(s.index) && live.has(s.index)),
      voters = (): Speaker[] => field().filter(s => hasRole(s, voterRoles)),
      liveSpeakers = (): Speaker[] => field().filter(s => !s.silent),
      candidates = (): Speaker[] => liveSpeakers().filter(s => hasRole(s, candidateRoles)),
      full = () => toContext(turns, labels, templates, args.context),
      closingContext = (speaker: Speaker) => withObjective(speaker, args.objectives, false, toContext(turns, labels, templates, args.context, speaker.index)),
      seen = makeSeen(mode, labels, templates, args.context, args.objectives, withObjective),
      refFull = () => withObjective(synth, args.objectives, true, full()), // neutral synth sees every team's objective
      deps = { synth, synthSelector, frame, prompt: args.prompt, labels, optional, templates, errors, live, liveSpeakers, full: refFull, telemetry, speakOne, record, note },
      runSynthesis = makeSynthesizer(deps),
      runElimination = makeEliminator(deps),
      runFrame = makeFramer(deps),
      runClosing = makeCloser({ roles: preset?.roles ?? [], rounds, budgetOk: () => !(tokenBudget && used() >= tokenBudget), speakers: liveSpeakers, context: closingContext, runParallel, speakOne, record, skip }),
      // voters = everyone who casts (incl. silent electorate); candidates = the non-silent field they vote FOR.
      runVote = makeVoter({ args, preset, rounds, budgetOk: () => !(tokenBudget && used() >= tokenBudget), liveSpeakers: voters, candidates, voteByTeam: preset?.voteByTeam === true, labels, seen, runHidden, note, telemetry, templates })

   for (let round = 1; round <= rounds; round++) {
      if (tokenBudget && used() >= tokenBudget) {
         for (let r = round; r <= rounds; r++) skip(r, 0, 'round', rotateTeams(liveSpeakers(), tagTeamRoles, r))
         log('warn', `⚠️ token budget ${tokenBudget} exceeded (${used()}) — skipping remaining turns`)
         break
      }
      // Framer opens/steers at the top of the round (before entry), so the field reacts to it.
      if (frameDue(reframeEvery, round)) await runFrame(round)
      // Staggered entry: a benched speaker joins on cadence and (sequential) speaks first this round.
      const
         entrant = entryDue(entry, enterEvery, round) ? nextEntrant(entry) : undefined,
         // The fresh entrant is nudged to bring something new instead of echoing the field.
         entrantPrompt = (s: Speaker): string | undefined => s.index === entrant?.index ? templates.entrant + args.prompt : undefined
      if (entrant) recordEntry(note, entrant, round, labels[entrant.index] ?? entrant.selector)
      const speaking = entrantFirst(rotateTeams(liveSpeakers(), tagTeamRoles, round), entrant)
      if (mode === 'sequential')
         for (let i = 0; i < speaking.length; i++) {
            if (tokenBudget && used() >= tokenBudget) { skip(round, i, 'round', speaking); break }
            record(await speakOne(speaking[i]!, round, 'round', seen(speaking[i]!, turns), entrantPrompt(speaking[i]!)), round)
         }
      else {
         const snapshot = [...turns]
         await runParallel(speaking, round, 'round', s => seen(s, snapshot), entrantPrompt)
      }
      if (runVote && !(closing && round === rounds)) await runVote(round, [...turns])
      // Per-round synthesis on the interval — but when closing is on, skip the final round's so there's one synthesis, after closing.
      if (synthInterval !== Infinity && (round % synthInterval === 0 || round === rounds) && !(closing && round === rounds))
         await runSynthesis(round)
      // Eliminations run on their own cadence after any synthesis, including the final round.
      if (eliminationDue(eliminateEvery, round))
         await runElimination(round)
   }

   // Closing statements: one final parallel pass over the whole transcript, right before the final synthesis.
   if (closing) await runClosing()
   if (closing && runVote) await runVote(rounds, [...turns])

   // End-only synthesis, or the single synthesis that follows closing statements, runs once after all rounds (round 0).
   if (synthInterval === Infinity || closing)
      await runSynthesis(0)

   return {
      content,
      structuredContent: {
         turns: telemetry,
         transcript: toContext(turns, labels, templates) ?? '',
         ...(args.preset ? { preset: args.preset } : {}),
         ...(tokenBudget ? { budget: { limit: tokenBudget, used: used(), exceeded: used() > tokenBudget } } : {})
      },
      isError: content.length === 0
   }
}
