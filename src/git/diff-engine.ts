import { minimatch } from 'minimatch';
import path from 'node:path';
import {
  simpleGit,
  type DiffResultNameStatusFile,
  type SimpleGit,
} from 'simple-git';

export type FileChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'unknown';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: string[];
}

export interface ChangedFile {
  path: string;
  status: FileChangeStatus;
  hunks: DiffHunk[];
  linesAdded: number;
  linesRemoved: number;
  language: string | null;
}

export type DiffMode =
  | { type: 'staged' }
  | { type: 'branch'; base: string; head: string };

export interface DiffEngineOptions {
  mode: DiffMode;
  ignorePatterns?: string[];
  cwd?: string;
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.swift': 'swift',
  '.scala': 'scala',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.toml': 'toml',
  '.md': 'markdown',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? null;
}

export function matchesIgnorePattern(
  filePath: string,
  patterns: string[],
): boolean {
  if (patterns.length === 0) {
    return false;
  }

  const normalized = normalizePath(filePath);
  return patterns.some((pattern) =>
    minimatch(normalized, pattern, { dot: true, matchBase: true }),
  );
}

function mapStatus(status: DiffResultNameStatusFile['status']): FileChangeStatus {
  switch (status) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'unknown';
  }
}

function resolveDisplayPath(file: string, status: FileChangeStatus): string {
  if (status === 'renamed' && file.includes(' -> ')) {
    const parts = file.split(' -> ');
    return parts[parts.length - 1]?.trim() ?? file;
  }

  return file;
}

function diffArgsForMode(mode: DiffMode): string[] {
  if (mode.type === 'staged') {
    return ['--cached'];
  }

  return [`${mode.base}...${mode.head}`];
}

interface ParsedFileDiff {
  path: string;
  hunks: DiffHunk[];
  linesAdded: number;
  linesRemoved: number;
  isBinary: boolean;
}

function countLineStats(hunks: DiffHunk[]): { linesAdded: number; linesRemoved: number } {
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded += 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        linesRemoved += 1;
      }
    }
  }

  return { linesAdded, linesRemoved };
}

/**
 * Parses unified diff output into per-file hunks.
 */
export function parseUnifiedDiff(patch: string): ParsedFileDiff[] {
  if (!patch.trim()) {
    return [];
  }

  const files: ParsedFileDiff[] = [];
  let current: ParsedFileDiff | null = null;
  let currentHunk: DiffHunk | null = null;

  const flushHunk = (): void => {
    if (current && currentHunk) {
      current.hunks.push(currentHunk);
      currentHunk = null;
    }
  };

  const flushFile = (): void => {
    flushHunk();
    if (current) {
      const stats = countLineStats(current.hunks);
      current.linesAdded = stats.linesAdded;
      current.linesRemoved = stats.linesRemoved;
      files.push(current);
      current = null;
    }
  };

  for (const rawLine of patch.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ')) {
      flushFile();

      const match = rawLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const filePath = match?.[2] ?? rawLine.replace(/^diff --git /, '').trim();

      current = {
        path: filePath,
        hunks: [],
        linesAdded: 0,
        linesRemoved: 0,
        isBinary: false,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (rawLine.startsWith('Binary files ') || rawLine === 'Binary files differ') {
      current.isBinary = true;
      continue;
    }

    if (rawLine.startsWith('@@')) {
      flushHunk();

      const headerMatch = rawLine.match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
      );

      currentHunk = {
        header: rawLine,
        oldStart: Number(headerMatch?.[1] ?? 0),
        oldLines: Number(headerMatch?.[2] ?? 1),
        newStart: Number(headerMatch?.[3] ?? 0),
        newLines: Number(headerMatch?.[4] ?? 1),
        lines: [],
      };
      continue;
    }

    if (
      currentHunk &&
      (rawLine.startsWith('+') ||
        rawLine.startsWith('-') ||
        rawLine.startsWith(' '))
    ) {
      currentHunk.lines.push(rawLine);
    }
  }

  flushFile();
  return files;
}

function buildSummaryMap(
  files: DiffResultNameStatusFile[],
): Map<string, DiffResultNameStatusFile> {
  const map = new Map<string, DiffResultNameStatusFile>();

  for (const file of files) {
    const status = mapStatus(file.status);
    const displayPath = resolveDisplayPath(file.file, status);
    map.set(displayPath, file);
    map.set(normalizePath(displayPath), file);
  }

  return map;
}

function mapNameStatusCode(code: string): FileChangeStatus {
  const normalized = code.charAt(0);

  switch (normalized) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'unknown';
  }
}

/**
 * Parses `git diff --name-status` output for authoritative per-file status codes.
 */
export function parseNameStatus(output: string): Map<string, FileChangeStatus> {
  const statuses = new Map<string, FileChangeStatus>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const tabParts = line.split('\t');
    const statusCode = tabParts[0] ?? '';

    if (tabParts.length >= 3 && (statusCode.startsWith('R') || statusCode.startsWith('C'))) {
      const newPath = normalizePath(tabParts[2] ?? '');
      statuses.set(newPath, mapNameStatusCode(statusCode));
      continue;
    }

    if (tabParts.length >= 2) {
      const filePath = normalizePath(tabParts[1] ?? '');
      statuses.set(filePath, mapNameStatusCode(statusCode));
    }
  }

  return statuses;
}

async function readNameStatus(
  git: SimpleGit,
  mode: DiffMode,
): Promise<Map<string, FileChangeStatus>> {
  const args = [...diffArgsForMode(mode), '--name-status'];
  const output = await git.diff(args);
  return parseNameStatus(output);
}

async function readDiff(git: SimpleGit, mode: DiffMode): Promise<string> {
  const args = diffArgsForMode(mode);
  return git.diff(args);
}

function isNameStatusFile(
  file: { file?: string; status?: unknown },
): file is DiffResultNameStatusFile {
  return typeof file.file === 'string' && typeof file.status === 'string';
}

async function readDiffSummary(
  git: SimpleGit,
  mode: DiffMode,
): Promise<DiffResultNameStatusFile[]> {
  const args = diffArgsForMode(mode);
  const summary = await git.diffSummary(args);
  return summary.files.filter(isNameStatusFile);
}

export async function getChangedFiles(
  options: DiffEngineOptions,
): Promise<ChangedFile[]> {
  const git = simpleGit(options.cwd);
  const ignorePatterns = options.ignorePatterns ?? [];

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(
      'Not a git repository. Run docusync from a directory with git initialized.',
    );
  }

  const [patch, summaryFiles, nameStatusByPath] = await Promise.all([
    readDiff(git, options.mode),
    readDiffSummary(git, options.mode),
    readNameStatus(git, options.mode),
  ]);

  const summaryByPath = buildSummaryMap(summaryFiles);
  const parsed = parseUnifiedDiff(patch);
  const changedFiles: ChangedFile[] = [];

  for (const fileDiff of parsed) {
    const displayPath = normalizePath(fileDiff.path);

    if (matchesIgnorePattern(displayPath, ignorePatterns)) {
      continue;
    }

    if (fileDiff.isBinary) {
      continue;
    }

    const summary = summaryByPath.get(displayPath) ?? summaryByPath.get(fileDiff.path);
    const status =
      nameStatusByPath.get(displayPath) ??
      (summary ? mapStatus(summary.status) : 'modified');

    const linesAdded = summary?.insertions ?? fileDiff.linesAdded;
    const linesRemoved = summary?.deletions ?? fileDiff.linesRemoved;

    if (summary?.binary) {
      continue;
    }

    changedFiles.push({
      path: displayPath,
      status,
      hunks: fileDiff.hunks,
      linesAdded,
      linesRemoved,
      language: detectLanguage(displayPath),
    });
  }

  return changedFiles.sort((a, b) => a.path.localeCompare(b.path));
}

export function validateDiffModeOptions(options: {
  staged?: boolean;
  base?: string;
  head?: string;
}): DiffMode {
  const hasStaged = Boolean(options.staged);
  const hasBase = Boolean(options.base);
  const hasHead = Boolean(options.head);

  if (hasStaged && (hasBase || hasHead)) {
    throw new Error('Cannot combine --staged with --base/--head.');
  }

  if ((hasBase && !hasHead) || (!hasBase && hasHead)) {
    throw new Error('Both --base and --head are required for branch comparison.');
  }

  if (hasBase && hasHead) {
    return { type: 'branch', base: options.base!, head: options.head! };
  }

  if (hasStaged || (!hasBase && !hasHead)) {
    return { type: 'staged' };
  }

  return { type: 'staged' };
}
