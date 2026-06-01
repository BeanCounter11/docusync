import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '../../../src/git/diff-engine.ts';
import { EMBEDDING_DIMENSIONS } from '../../../src/index/embedder.ts';
import { IndexStore } from '../../../src/index/store.ts';
import { buildRetrievalQuery } from '../../../src/map/query-builder.ts';
import { mapDiffToDocs } from '../../../src/map/semantic-mapper.ts';
import { defaultConfig } from '../../../src/config/schema.ts';
import type { DocuSyncConfig } from '../../../src/config/schema.ts';

function unitVector(primary: number, secondary: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const magnitude = Math.hypot(primary, secondary);

  if (magnitude === 0) {
    vector[0] = 1;
    return vector;
  }

  vector[0] = primary / magnitude;
  vector[1] = secondary / magnitude;
  return vector;
}

function createAuthChangedFile(): ChangedFile {
  return {
    path: 'src/middleware/auth.ts',
    status: 'modified',
    language: 'typescript',
    linesAdded: 18,
    linesRemoved: 2,
    hunks: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 8,
        header: '@@ -1,3 +1,8 @@',
        lines: [
          '+export function authenticateRequest() {',
          '+  return verifyJwtToken();',
          '+}',
          '+export class AuthMiddleware {',
          '+  handle() {',
          '+    return authenticateRequest();',
          '+  }',
          '+}',
        ],
      },
    ],
  };
}

function createNewBillingFile(): ChangedFile {
  return {
    path: 'src/features/billing.ts',
    status: 'added',
    language: 'typescript',
    linesAdded: 40,
    linesRemoved: 0,
    hunks: [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 4,
        header: '@@ -0,0 +1,4 @@',
        lines: [
          '+export function createInvoice() {',
          '+  return { total: 0 };',
          '+}',
        ],
      },
    ],
  };
}

function createMinorChangedFile(): ChangedFile {
  return {
    path: 'src/utils/format.ts',
    status: 'modified',
    language: 'typescript',
    linesAdded: 1,
    linesRemoved: 1,
    hunks: [
      {
        oldStart: 10,
        oldLines: 1,
        newStart: 10,
        newLines: 1,
        header: '@@ -10,1 +10,1 @@',
        lines: ['-const spacing = 2;', '+const spacing = 4;'],
      },
    ],
  };
}

function seedDocumentationIndex(store: IndexStore): void {
  store.insertChunk(
    {
      filePath: 'docs/authentication.md',
      heading: '## Authentication Middleware',
      textContent:
        '## Authentication Middleware\n\nUse authenticateRequest and AuthMiddleware to verify JWT tokens for protected routes.',
      contentHash: 'auth-doc-hash',
    },
    unitVector(1, 0),
  );

  store.insertChunk(
    {
      filePath: 'docs/database.md',
      heading: '## Database Migrations',
      textContent:
        '## Database Migrations\n\nRun schema migrations and manage connection pooling for PostgreSQL.',
      contentHash: 'db-doc-hash',
    },
    unitVector(0, 1),
  );
}

const mockEmbedFn = async (text: string): Promise<number[]> => {
  const normalized = text.toLowerCase();

  if (
    normalized.includes('auth') ||
    normalized.includes('jwt') ||
    normalized.includes('middleware')
  ) {
    return unitVector(0.95, 0.05);
  }

  if (normalized.includes('billing') || normalized.includes('invoice')) {
    return unitVector(0.05, 0.05);
  }

  return unitVector(0.15, 0.15);
};

describe('buildRetrievalQuery', () => {
  it('includes file path, symbols, and added line summaries', () => {
    const file = createAuthChangedFile();
    const query = buildRetrievalQuery({
      file,
      symbols: ['authenticateRequest', 'AuthMiddleware'],
    });

    expect(query).toContain('src/middleware/auth.ts');
    expect(query).toContain('authenticateRequest');
    expect(query).toContain('export function authenticateRequest');
  });
});

describe('mapDiffToDocs', () => {
  it('maps auth-related code changes to the authentication guide', async () => {
    const store = IndexStore.open(':memory:');
    seedDocumentationIndex(store);

    const config: DocuSyncConfig = {
      ...defaultConfig,
      index: {
        ...defaultConfig.index,
        similarityThreshold: 0.5,
        topK: 3,
      },
    };

    const results = await mapDiffToDocs({
      config,
      changedFiles: [createAuthChangedFile()],
      store,
      embedFn: mockEmbedFn,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe('update');
    expect(results[0]?.matchedDocPath).toBe('docs/authentication.md');
    expect(results[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(results[0]?.matchedChunks[0]?.heading).toContain('Authentication');

    store.close();
  });

  it('routes unmatched significant files to draft', async () => {
    const store = IndexStore.open(':memory:');
    seedDocumentationIndex(store);

    const config: DocuSyncConfig = {
      ...defaultConfig,
      significance: {
        ...defaultConfig.significance,
        minLinesChanged: 15,
      },
      index: {
        ...defaultConfig.index,
        similarityThreshold: 0.75,
        topK: 3,
      },
    };

    const results = await mapDiffToDocs({
      config,
      changedFiles: [createNewBillingFile()],
      store,
      embedFn: mockEmbedFn,
    });

    expect(results[0]?.action).toBe('draft');
    expect(results[0]?.isSignificant).toBe(true);
    expect(results[0]?.matchedDocPath).toBeUndefined();

    store.close();
  });

  it('skips minor changes with no documentation match', async () => {
    const store = IndexStore.open(':memory:');
    seedDocumentationIndex(store);

    const config: DocuSyncConfig = {
      ...defaultConfig,
      significance: {
        ...defaultConfig.significance,
        minLinesChanged: 15,
      },
      index: {
        ...defaultConfig.index,
        similarityThreshold: 0.75,
        topK: 3,
      },
    };

    const results = await mapDiffToDocs({
      config,
      changedFiles: [createMinorChangedFile()],
      store,
      embedFn: mockEmbedFn,
    });

    expect(results[0]?.action).toBe('skip');
    expect(results[0]?.isSignificant).toBe(false);

    store.close();
  });
});

describe('cosineDistanceToSimilarity integration', () => {
  it('returns near-perfect similarity for identical vectors', () => {
    const store = IndexStore.open(':memory:');
    const vector = unitVector(1, 0);

    store.insertChunk(
      {
        filePath: 'docs/auth.md',
        heading: '## Auth',
        textContent: 'Auth content',
        contentHash: 'hash-1',
      },
      vector,
    );

    const matches = store.searchByCosineDistance(vector, 1);
    expect(matches[0]?.similarity).toBeCloseTo(1, 5);

    store.close();
  });
});
