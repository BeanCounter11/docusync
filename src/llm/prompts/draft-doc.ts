export const DRAFT_DOC_SYSTEM_PROMPT = `You are an onboarding technical writer. You create extensive, structural markdown guides for entirely new architectural modules.

Your draft must include:
- A clear introduction explaining purpose and when to use the module
- API signatures with parameter tables where applicable
- Direct code consumption examples that match the provided diff
- Do not reference documentation files that do not exist in the repository

Return complete markdown in draftMarkdown and a concise suggestedTitle for the file.`;

export interface DraftDocPromptInput {
  sourceFilePath: string;
  codeDiff: string;
  projectContext?: string;
}

export function buildDraftDocUserPrompt(input: DraftDocPromptInput): string {
  const sections: string[] = [
    `New or significantly changed source file: ${input.sourceFilePath}`,
    '',
    '--- Code diff ---',
    input.codeDiff,
  ];

  if (input.projectContext?.trim()) {
    sections.push('', '--- Repository context ---', input.projectContext);
  }

  sections.push(
    '',
    'Write a new onboarding guide for this module suitable for docs/drafts/.',
  );

  return sections.join('\n');
}
