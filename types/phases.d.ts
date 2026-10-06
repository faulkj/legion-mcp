/** Dependencies the neutral phases (frame, synthesis, elimination) borrow from the running quorum. */
interface PhaseDeps {
   /** Resolved at call time: a neutral synth seat, or the first live speaker of a playing synth role. */
   synth: () => Speaker | undefined
   synthSelector: string | undefined
   /** The synth role plays normal rounds, so its final turn is a last-standing close rather than a neutral synthesis. */
   playing: boolean
   eliminator: Speaker | undefined
   frame: Speaker | undefined
   prompt: string
   labels: string[]
   optional: boolean
   templates: PromptTemplates
   errors: ErrorMessages
   live: Set<number>
   liveSpeakers: () => Speaker[]
   full: () => string | undefined
   telemetry: TurnTelemetry[]
   cancelled: TurnRunner['cancelled']
   speakOne: TurnRunner['speakOne']
   record: TurnRunner['record']
   note: TurnRunner['note']
}

/** Dependencies for the closing phase: normal closers speak in parallel, then designated final closers respond with the updated transcript. */
interface ClosingDeps {
   roles: PresetRole[]
   rounds: number
   budgetOk: () => boolean
   speakers: () => Speaker[]
   context: (speaker: Speaker) => string | undefined
   runParallel: TurnRunner['runParallel']
   speakOne: TurnRunner['speakOne']
   record: TurnRunner['record']
   skip: TurnRunner['skip']
}

