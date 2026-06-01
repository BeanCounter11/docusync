import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../src/config/schema.ts';
import type { ChangedFile } from '../../../src/git/diff-engine.js';
import * as diffEngine from '../../../src/git/diff-engine.js';
import { backupPathFor, updateExistingDoc } from '../../../src/write/doc-writer.js';
import {
  buildDraftFilename,
  createDraftDoc,
  slugifyTitle,
} from '../../../src/write/draft-writer.js';
import * as semanticMapper from '../../../src/map/semantic-mapper.js';
import { runPipeline } from '../../../src/pipeline/run.js';

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = path.join(
    process.cwd(),
    '.test-tmp',
    `docusync-write-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('doc-writer integration', () => {
  it('creates a .md.bak backup before overwriting', async () => {
    const cwd = await createTempDir();
    const docPath = 'docs/guide.md';
    const absoluteDoc = path.join(cwd, docPath);

    await mkdir(path.dirname(absoluteDoc), { recursive: true });
    await writeFile(absoluteDoc, '# Guide\n\nOriginal content.\n', 'utf-8');

    const config = { ...defaultConfig, backup: true };

    await updateExistingDoc(docPath, '# Guide\n\nUpdated content.\n', config, {
      cwd,
      backup: true,
    });

    const backupContent = await readFile(backupPathFor(absoluteDoc), 'utf-8');
    const updatedContent = await readFile(absoluteDoc, 'utf-8');

    expect(backupContent).toContain('Original content');
    expect(updatedContent).toContain('Updated content');
  });

  it('skips disk writes when dryRun is enabled', async () => {
    const cwd = await createTempDir();
    const docPath = 'docs/guide.md';
    const absoluteDoc = path.join(cwd, docPath);

    await mkdir(path.dirname(absoluteDoc), { recursive: true });
    await writeFile(absoluteDoc, '# Guide\n\nOriginal.\n', 'utf-8');

    await updateExistingDoc(docPath, '# Guide\n\nShould not apply.\n', defaultConfig, {
      cwd,
      dryRun: true,
    });

    const content = await readFile(absoluteDoc, 'utf-8');
    expect(content).toContain('Original');
  });
});

describe('draft-writer integration', () => {
  it('writes drafts using YYYYMMDD-slugified-title.md pattern', async () => {
    const cwd = await createTempDir();
    const fixedDate = new Date('2026-05-31T12:00:00Z');
    const config = {
      ...defaultConfig,
      docs: { ...defaultConfig.docs, draftsDir: 'docs/drafts' },
    };

    const outputPath = await createDraftDoc(
      'Webhooks API Guide 🚀',
      '# Webhooks\n\nDraft body.',
      config,
      { cwd, now: fixedDate },
    );

    expect(outputPath).toBe(
      path.join(cwd, 'docs', 'drafts', '20260531-webhooks-api-guide.md'),
    );

    const written = await readFile(outputPath, 'utf-8');
    expect(written).toContain('Draft body');
  });

  it('slugifies titles safely for the filesystem', () => {
    expect(slugifyTitle('Hello World!')).toBe('hello-world');
    expect(buildDraftFilename('Payments API', new Date('2026-01-02T00:00:00Z'))).toBe(
      '20260102-payments-api.md',
    );
  });
});

describe('pipeline dry-run integration', () => {
  const authFile: ChangedFile = {
    path: 'src/auth/middleware.ts',
    status: 'modified',
    language: 'typescript',
    linesAdded: 20,
    linesRemoved: 1,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 3,
        header: '@@ -1 +1,3 @@',
        lines: ['+export function authenticate() {}'],
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs end-to-end in dry-run without writing documentation files', async () => {
    const cwd = await createTempDir();
    const docPath = path.join(cwd, 'docs', 'authentication.md');
    const draftsDir = path.join(cwd, 'docs', 'drafts');

    await mkdir(path.dirname(docPath), { recursive: true });
    await writeFile(docPath, '# Auth\n\nExisting auth guide.\n', 'utf-8');

    vi.spyOn(diffEngine, 'getChangedFiles').mockResolvedValue([authFile]);
    vi.spyOn(semanticMapper, 'mapDiffToDocs').mockResolvedValue([
      {
        file: authFile,
        action: 'update',
        matchedDocPath: 'docs/authentication.md',
        confidence: 0.94,
        matchedChunks: [
          {
            heading: '## Authentication',
            text: 'Auth guide chunk',
            score: 0.94,
          },
        ],
        reason: 'Matched',
        query: 'auth query',
        isSignificant: true,
      },
    ]);

    const mockModel = { modelId: 'mock-model' };

    const result = await runPipeline({
      config: defaultConfig,
      cwd,
      dryRun: true,
      silent: true,
      model: mockModel as never,
      generateObjectFn: vi.fn().mockResolvedValue({
        object: {
          updatedMarkdown: '# Auth\n\nUpdated auth guide.\n',
          changeSummary: 'Synced middleware section',
          confidence: 0.94,
        },
      }),
    });

    expect(result.dryRun).toBe(true);
    expect(result.items[0]?.status).toBe('dry_run_update');

    const docContent = await readFile(docPath, 'utf-8');
    expect(docContent).toContain('Existing auth guide');

    await expect(access(draftsDir)).rejects.toThrow();
  });
});
