import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chunkMarkdown, hashFileContent } from '../../../src/index/chunker.ts';
import { EMBEDDING_DIMENSIONS } from '../../../src/index/embedder.ts';
import {
  getIndexerIgnorePatterns,
  indexDocuments,
  shouldIgnoreIndexerPath,
} from '../../../src/index/indexer.ts';
import { IndexStore } from '../../../src/index/store.ts';
import { defaultConfig, resolveConfig } from '../../../src/config/schema.ts';

function createUnitVector(primary: number, secondary: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = primary;
  vector[1] = secondary;
  const magnitude = Math.hypot(primary, secondary);

  if (magnitude === 0) {
    vector[0] = 1;
    return vector;
  }

  vector[0] = primary / magnitude;
  vector[1] = secondary / magnitude;
  return vector;
}

describe('IndexStore', () => {
  let store: IndexStore;

  afterEach(() => {
    store?.close();
  });

  it('initializes metadata and vector tables', () => {
    store = IndexStore.open(':memory:');
    expect(store.getChunkCount()).toBe(0);
  });

  it('inserts chunks with 384-dimensional vectors and retrieves metadata', () => {
    store = IndexStore.open(':memory:');
    const embedding = createUnitVector(1, 0);

    const chunkId = store.insertChunk(
      {
        filePath: 'docs/guide.md',
        heading: '## Setup',
        textContent: '## Setup\n\nInstall dependencies.',
        contentHash: 'hash-setup',
      },
      embedding,
    );

    const record = store.getChunkById(chunkId);
    expect(record?.heading).toBe('## Setup');
    expect(store.getChunkEmbedding(chunkId)).toEqual(embedding);
    expect(store.getChunkCount()).toBe(1);
  });

  it('finds similar vectors via vec_distance_cosine', () => {
    store = IndexStore.open(':memory:');

    const guideVector = createUnitVector(1, 0);
    const apiVector = createUnitVector(0, 1);

    store.insertChunk(
      {
        filePath: 'docs/guide.md',
        heading: '## Guide',
        textContent: 'Guide content',
        contentHash: 'hash-guide',
      },
      guideVector,
    );

    store.insertChunk(
      {
        filePath: 'docs/api.md',
        heading: '## API',
        textContent: 'API content',
        contentHash: 'hash-api',
      },
      apiVector,
    );

    const results = store.searchSimilar(guideVector, 2);

    expect(results).toHaveLength(2);
    expect(results[0]?.filePath).toBe('docs/guide.md');
    expect(results[0]?.similarity).toBeCloseTo(1, 5);
    expect(results[1]?.filePath).toBe('docs/api.md');
  });

  it('reuses cached chunk hashes without requiring identical file paths', () => {
    store = IndexStore.open(':memory:');
    const sharedHash = 'shared-chunk-hash';
    const embedding = createUnitVector(0.8, 0.2);

    const firstId = store.insertChunk(
      {
        filePath: 'docs/a.md',
        heading: '## Shared',
        textContent: 'Shared chunk body',
        contentHash: sharedHash,
      },
      embedding,
    );

    const cached = store.findCachedChunkByHash(sharedHash);
    expect(cached?.id).toBe(firstId);

    const cachedEmbedding = store.getChunkEmbedding(firstId);
    const secondId = store.insertChunk(
      {
        filePath: 'docs/b.md',
        heading: '## Shared Copy',
        textContent: 'Shared chunk body',
        contentHash: sharedHash,
      },
      cachedEmbedding ?? embedding,
    );

    expect(secondId).toBeGreaterThan(firstId);

    const stored = store.getChunkEmbedding(secondId);
    expect(stored?.[0]).toBeCloseTo(embedding[0]!, 5);
    expect(stored?.[1]).toBeCloseTo(embedding[1]!, 5);
    expect(stored).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('tracks per-file hashes and deletes stale chunks for a file', () => {
    store = IndexStore.open(':memory:');

    store.upsertIndexedFile('docs/guide.md', 'hash-v1');
    const chunkId = store.insertChunk(
      {
        filePath: 'docs/guide.md',
        heading: '## Old',
        textContent: 'Old content',
        contentHash: 'chunk-old',
      },
      createUnitVector(1, 0),
    );

    expect(store.getIndexedFile('docs/guide.md')?.contentHash).toBe('hash-v1');
    expect(store.getChunkIdsForFile('docs/guide.md')).toEqual([chunkId]);

    store.deleteChunksForFile('docs/guide.md');
    expect(store.getChunkCount()).toBe(0);
    expect(store.getChunkIdsForFile('docs/guide.md')).toEqual([]);
  });
});

describe('indexer integration', () => {
  let repoDir: string;

  afterEach(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('skips unchanged files based on indexed file hash', async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), 'docusync-index-'));
    await mkdir(path.join(repoDir, 'docs'), { recursive: true });

    await writeFile(
      path.join(repoDir, 'docs', 'guide.md'),
      '# Guide\n\nInitial content.\n',
    );

    const config = resolveConfig({
      docs: { roots: ['docs'], draftsDir: 'docs/drafts' },
      index: { dbPath: '.docusync/test-index.db', embeddingModel: 'Xenova/all-MiniLM-L6-v2' },
    });

    const embedFn = async (text: string) =>
      createUnitVector((text.length % 7) + 1, 0.25);

    const firstRun = await indexDocuments({ config, cwd: repoDir, embedFn });
    expect(firstRun.filesReindexed).toBe(1);
    expect(firstRun.chunksEmbedded).toBeGreaterThan(0);

    const secondRun = await indexDocuments({ config, cwd: repoDir, embedFn });
    expect(secondRun.filesSkipped).toBe(1);
    expect(secondRun.filesReindexed).toBe(0);
    expect(secondRun.chunksEmbedded).toBe(0);
  });

  it('respects draft directory exclusions', () => {
    const config = resolveConfig({
      docs: {
        roots: ['docs'],
        draftsDir: 'docs/drafts',
        ignore: ['docs/drafts/**', 'node_modules/**'],
      },
    });

    const patterns = getIndexerIgnorePatterns(config);
    expect(
      shouldIgnoreIndexerPath('docs/drafts/new-feature.md', patterns),
    ).toBe(true);
    expect(shouldIgnoreIndexerPath('docs/guide.md', patterns)).toBe(false);
  });
});

describe('chunkMarkdown', () => {
  it('splits markdown by headings and hashes chunk content', () => {
    const markdown = `# Guide

Intro paragraph.

## Setup

Install the CLI.

### Advanced

Extra details.
`;

    const chunks = chunkMarkdown('docs/guide.md', markdown, { maxChars: 500 });

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]?.heading).toMatch(/Guide|#/);
    expect(chunks.some((chunk) => chunk.heading.includes('Setup'))).toBe(true);
    expect(chunks.every((chunk) => chunk.contentHash.length > 0)).toBe(true);
    expect(hashFileContent(markdown).length).toBeGreaterThan(0);
  });
});
