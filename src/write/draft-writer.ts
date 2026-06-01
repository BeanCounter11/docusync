import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DocuSyncConfig } from '../config/schema.js';
import { atomicWriteFile } from './doc-writer.js';

export interface CreateDraftDocOptions {
  cwd?: string;
  dryRun?: boolean;
  now?: Date;
}

/**
 * Slugifies a suggested title for safe filesystem usage.
 */
export function slugifyTitle(title: string): string {
  const withoutEmoji = title.replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,
    '',
  );

  return withoutEmoji
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'draft';
}

/**
 * Builds `YYYYMMDD-slugified-title.md` filename format.
 */
export function buildDraftFilename(
  suggestedTitle: string,
  now: Date = new Date(),
): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const slug = slugifyTitle(suggestedTitle);

  return `${year}${month}${day}-${slug}.md`;
}

/**
 * Creates a new draft markdown file under config.docs.draftsDir.
 * Returns the absolute path of the written file.
 */
export async function createDraftDoc(
  suggestedTitle: string,
  draftContent: string,
  config: DocuSyncConfig,
  options: CreateDraftDocOptions = {},
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const draftsDir = path.resolve(cwd, config.docs.draftsDir);
  const filename = buildDraftFilename(suggestedTitle, options.now);
  const absolutePath = path.join(draftsDir, filename);

  if (options.dryRun) {
    return absolutePath;
  }

  await mkdir(draftsDir, { recursive: true });
  await atomicWriteFile(absolutePath, draftContent);

  return absolutePath;
}
