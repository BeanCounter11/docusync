import { getFileName } from '../git/significance.js';
import type { ChangedFile } from '../git/diff-engine.js';

const MAX_ADDED_LINE_CHARS = 1200;
const MAX_ADDED_LINES = 24;

export interface QueryBuildInput {
  file: ChangedFile;
  symbols: string[];
}

function summarizeAddedLines(file: ChangedFile): string {
  const added: string[] = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (!line.startsWith('+') || line.startsWith('+++')) {
        continue;
      }

      added.push(line.slice(1).trim());

      if (added.length >= MAX_ADDED_LINES) {
        break;
      }
    }

    if (added.length >= MAX_ADDED_LINES) {
      break;
    }
  }

  const joined = added.join('\n');
  if (joined.length <= MAX_ADDED_LINE_CHARS) {
    return joined;
  }

  return `${joined.slice(0, MAX_ADDED_LINE_CHARS)}...`;
}

/**
 * Builds a descriptive retrieval query from a changed file (not raw diff noise).
 */
export function buildRetrievalQuery(input: QueryBuildInput): string {
  const { file, symbols } = input;
  const fileName = getFileName(file.path);
  const parts: string[] = [
    `Source file: ${file.path}`,
    `File name: ${fileName}`,
    `Language: ${file.language ?? 'unknown'}`,
    `Change type: ${file.status}`,
  ];

  if (symbols.length > 0) {
    parts.push(`Changed symbols: ${symbols.join(', ')}`);
  }

  const addedSummary = summarizeAddedLines(file);
  if (addedSummary) {
    parts.push(`Added or modified lines:\n${addedSummary}`);
  }

  return parts.join('\n');
}
