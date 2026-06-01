import path from 'node:path';
import { minimatch } from 'minimatch';
import type { DocuSyncConfig } from '../config/schema.js';
import type { ChangedFile } from './diff-engine.js';

export interface SignificanceResult {
  isSignificant: boolean;
  symbols: string[];
  reasons: string[];
}

const EXPORT_PATTERNS: RegExp[] = [
  /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+enum\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+default\s+(?:function|class)\s*([A-Za-z_$][\w$]*)?/g,
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function matchesGlob(filePath: string, patterns: string[]): boolean {
  const normalized = normalizePath(filePath);
  return patterns.some((pattern) =>
    minimatch(normalized, pattern, { dot: true, matchBase: true }),
  );
}

function extractSymbolsFromHunks(file: ChangedFile): string[] {
  const symbols = new Set<string>();

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (!line.startsWith('+') || line.startsWith('+++')) {
        continue;
      }

      const content = line.slice(1);

      for (const pattern of EXPORT_PATTERNS) {
        pattern.lastIndex = 0;
        let match = pattern.exec(content);

        while (match) {
          const name = match[1];
          if (name) {
            symbols.add(name);
          }

          match = pattern.exec(content);
        }
      }
    }
  }

  return [...symbols];
}

function isIncludedPath(filePath: string, config: DocuSyncConfig): boolean {
  const includeGlobs = config.significance.includeGlobs ?? [];

  if (includeGlobs.length === 0) {
    return true;
  }

  return matchesGlob(filePath, includeGlobs);
}

export function assessSignificance(
  file: ChangedFile,
  config: DocuSyncConfig,
): SignificanceResult {
  const reasons: string[] = [];
  const symbols = extractSymbolsFromHunks(file);
  const excludeGlobs = config.significance.excludeGlobs ?? [];

  if (matchesGlob(file.path, excludeGlobs)) {
    return {
      isSignificant: false,
      symbols,
      reasons: ['Excluded by significance.excludeGlobs'],
    };
  }

  if (!isIncludedPath(file.path, config)) {
    return {
      isSignificant: false,
      symbols,
      reasons: ['Outside significance.includeGlobs'],
    };
  }

  if (file.status === 'added') {
    reasons.push('New file added');
  }

  if (symbols.length > 0) {
    reasons.push(`Exported symbols detected: ${symbols.join(', ')}`);
  }

  const totalLines = file.linesAdded + file.linesRemoved;
  if (totalLines >= config.significance.minLinesChanged) {
    reasons.push(
      `Line churn ${totalLines} >= minLinesChanged ${config.significance.minLinesChanged}`,
    );
  }

  const isSignificant =
    file.status === 'added' ||
    symbols.length > 0 ||
    totalLines >= config.significance.minLinesChanged;

  return {
    isSignificant,
    symbols,
    reasons: isSignificant ? reasons : ['Minor change below significance thresholds'],
  };
}

export function getFileName(filePath: string): string {
  return path.basename(filePath);
}
