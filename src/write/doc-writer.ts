import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DocuSyncConfig } from '../config/schema.js';

export interface UpdateExistingDocOptions {
  cwd?: string;
  backup?: boolean;
  dryRun?: boolean;
}

function resolveAbsolutePath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function backupPathFor(filePath: string): string {
  return `${filePath}.md.bak`;
}

export async function atomicWriteFile(
  absolutePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true });

  const tempPath = `${absolutePath}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, absolutePath);
}

/**
 * Atomically updates an existing markdown documentation file.
 */
export async function updateExistingDoc(
  filePath: string,
  updatedContent: string,
  config: DocuSyncConfig,
  options: UpdateExistingDocOptions = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const absolutePath = resolveAbsolutePath(filePath, cwd);
  const shouldBackup = options.backup ?? config.backup;

  if (options.dryRun) {
    return;
  }

  try {
    await readFile(absolutePath, 'utf-8');

    if (shouldBackup) {
      await copyFile(absolutePath, backupPathFor(absolutePath));
    }
  } catch {
    // New file at doc path — no backup source yet.
  }

  await atomicWriteFile(absolutePath, updatedContent);
}

export { backupPathFor, resolveAbsolutePath };
