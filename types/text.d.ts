/** Overridable runtime error messages loaded from config/errors.json. Tokens in {braces} are filled at runtime. */
interface ErrorMessages {
   unknownRole: string
   unknownSelector: string
   adhocDisabled: string
   adhocEmptyName: string
   unresolvableSelector: string
   synthFailed: string
   modelFailed: string
   unknownPreset: string
   roleNotInPreset: string
   presetRoleUnderStaffed: string
   presetRoleOverStaffed: string
   presetRoleMissingFile: string
   presetSynthUncovered: string
   closingWithoutSynth: string
   eliminateWithoutSynth: string
   synthTeamed: string
   frameTeamed: string
   cancelled: string
   jobsBusy: string
   jobHandle: string
   jobNotFound: string
}

/** Overridable prompt-shaping templates loaded from config/prompts.json. Tokens in {braces} are filled at runtime. */
interface PromptTemplates {
   roleContract: string
   contextBlock: string
   transcriptBlock: string
   roundExploring: string
   roundFinal: string
   roundSynthesis: string
   closingStatement: string
   elimination: string
   incompleteContest: string
   entrant: string
   frame: string
   reframe: string
   vote: string
   synthesis: string
   truncatedTurn: string
   degenerateTurn: string
   failedTurn: { timeout: string; empty: string; error: string }
}
