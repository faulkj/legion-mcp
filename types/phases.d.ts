/** Dependencies the neutral phases (frame, synthesis, elimination) borrow from the running quorum. */
interface PhaseDeps {
   synth: Speaker | undefined
   synthSelector: string | undefined
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

