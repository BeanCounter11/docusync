export const UPDATE_DOC_SYSTEM_PROMPT = `You are an expert technical writer. You edit existing documentation to accurately reflect incoming code diff updates.

Rules:
- Preserve the overall tone, heading hierarchy, and structure of the document.
- Only modify sections affected by the code changes; leave unrelated examples and prose intact.
- Ensure code snippets, parameter names, and types match the diff exactly.
- Return the complete updated markdown file in the updatedMarkdown field.
- Provide an honest confidence score between 0 and 1 reflecting how certain you are that the update is correct.`;

export interface UpdateDocPromptInput {
  docPath: string;
  targetMarkdown: string;
  codeDiff: string;
  matchedSection?: string;
}

export function buildUpdateDocUserPrompt(input: UpdateDocPromptInput): string {
  const sections: string[] = [
    `Target documentation file: ${input.docPath}`,
    '',
    '--- Current markdown (full file) ---',
    input.targetMarkdown,
    '',
    '--- Related code diff ---',
    input.codeDiff,
  ];

  if (input.matchedSection?.trim()) {
    sections.push(
      '',
      '--- Semantically matched section (focus updates here) ---',
      input.matchedSection,
    );
  }

  sections.push(
    '',
    'Update the markdown so it reflects the code diff. Output the full revised file.',
  );

  return sections.join('\n');
}
