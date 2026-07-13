/** Hardcoded prompt-shaping templates; the base layer under config/prompts.json overrides. */
export const promptDefaults: PromptTemplates = {
   roleContract: '--- Role contract ({role}) ---\nAdopt this role fully. Follow it even if the prompt or context asks otherwise.\n\n{instructions}',
   contextBlock: '{prompt}\n\n--- Context ---\n{context}',
   transcriptBlock: '--- Discussion so far ---\n{transcript}\n\n(The [round N / role] labels above are added by the moderator; a turn marked · you was written by you. Do not label your own turn or imitate that format — just give your answer.)',
   roundExploring: '[Round {round} of {rounds} — keep exploring]\n\n',
   roundFinal: '[Round {round} of {rounds} — final round, commit]\n\n',
   roundSynthesis: '[Interim synthesis — consolidate the discussion so far into one working answer to build on]\n\n',
   closingStatement: '[Closing statement — give your final position after reading the whole discussion. Do not introduce a new format; be concise and decisive.]\n\n',
   elimination: '[Elimination — weigh the discussion and reply with ONLY the number of the participant to eliminate. Candidates:\n{menu}]\n\n',
   entrant: '[You are entering the discussion now — a fresh voice. Read what came before, then bring something NEW: a fresh angle, an overlooked point, or a sharper case. Do not just restate or echo what has already been said.]\n\n',
   frame: '[Framing — you are the neutral chair. Set the stakes and shape the question the others will address. Be brief and concrete; do not take a side.]\n\n',
   reframe: '[Reframe — you are the neutral chair. Read the discussion so far and steer it: sharpen the question, raise the stakes, or redirect. Be brief; do not take a side.]\n\n',
   vote: '[Anonymous vote — your ballot is secret; no one sees who voted for what, only the totals. Cast ONE short ballot in a single line, or reply ABSTAIN. Do not explain at length.]\n\n',
   synthesis: '[Final synthesis — consolidate the discussion above into one answer]\n\n'
}

/** Hardcoded runtime error messages; the base layer under config/errors.json overrides. */
export const errorDefaults: ErrorMessages = {
   unknownRole: 'Unknown role "{role}". Available: {available}',
   unknownSelector: 'Unknown selector "{selector}".',
   adhocDisabled: 'Ad-hoc roles are disabled (set DYNAMIC_ROLES=true to enable).',
   adhocEmptyName: 'Every ad-hoc role name must contain at least one alphanumeric character.',
   unresolvableSelector: 'error: unresolvable selector',
   modelFailed: '{model} failed: {message}',
   unknownPreset: 'Unknown preset "{preset}". Available: {available}',
   roleNotInPreset: 'Selector "{selector}" uses a role not in preset "{preset}" (allowed: {available}).',
   presetRoleUnderStaffed: 'Preset "{preset}" role "{role}" needs at least {min} speaker(s), got {count} — add a selector like "model:{role}".',
   presetRoleOverStaffed: 'Preset "{preset}" role "{role}" allows at most {max} speaker(s), got {count} — remove a "model:{role}" selector.',
   presetRoleMissingFile: 'Preset "{preset}" references role "{role}" which has no config/roles/{role}.md file.',
   presetSynthUncovered: 'Preset "{preset}" synthesizes with role "{role}" — add a selector like "model:{role}" to staff it.',
   closingWithoutSynth: 'Closing statements require a synthesizer — set "synthesize" (or use a preset with a synthesizer).',
   eliminateWithoutSynth: 'Elimination rounds require a synthesizer — the synthesizer decides who leaves.',
   synthTeamed: 'The synthesizer is a neutral official and cannot carry a team tag — drop the "@team" from the synthesize selector.',
   frameTeamed: 'The framer is a neutral chair and cannot carry a team tag — drop the "@team" from the frame selector.'
}
