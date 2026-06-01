import type { ChangedFile } from './diff-engine.js';

/**
 * Formats a ChangedFile as a unified-style diff block for LLM context.
 */
export function formatChangedFileAsDiff(file: ChangedFile): string {
  const parts: string[] = [
    `--- a/${file.path}`,
    `+++ b/${file.path}`,
    `change-type: ${file.status}`,
    `lines-added: ${file.linesAdded}`,
    `lines-removed: ${file.linesRemoved}`,
  ];

  for (const hunk of file.hunks) {
    parts.push(hunk.header);
    parts.push(...hunk.lines);
  }

  return parts.join('\n');
}
