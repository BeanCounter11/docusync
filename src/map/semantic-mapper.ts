import path from 'node:path';
import type { DocuSyncConfig } from '../config/schema.js';
import type { ChangedFile } from '../git/diff-engine.js';
import { assessSignificance } from '../git/significance.js';
import type { EmbedFn } from '../index/indexer.js';
import { getEmbedding } from '../index/embedder.js';
import {
  cosineDistanceToSimilarity,
  openIndexStore,
  type IndexStore,
  type SimilarChunkResult,
} from '../index/store.js';
import { buildRetrievalQuery } from './query-builder.js';

export type MapAction = 'update' | 'draft' | 'skip';

export interface MatchedChunk {
  heading: string;
  text: string;
  score: number;
}

export interface MapResult {
  file: ChangedFile;
  action: MapAction;
  matchedDocPath?: string;
  confidence: number;
  matchedChunks: MatchedChunk[];
  reason: string;
  query: string;
  isSignificant: boolean;
}

export interface MapDiffToDocsOptions {
  config: DocuSyncConfig;
  changedFiles: ChangedFile[];
  cwd?: string;
  store?: IndexStore;
  embedFn?: EmbedFn;
}

function toMatchedChunks(
  results: SimilarChunkResult[],
  threshold: number,
): MatchedChunk[] {
  return results
    .filter((result) => result.similarity >= threshold)
    .map((result) => ({
      heading: result.heading,
      text: result.textContent,
      score: result.similarity,
    }));
}

function resolveAction(
  bestMatch: SimilarChunkResult | undefined,
  threshold: number,
  significance: ReturnType<typeof assessSignificance>,
): Pick<MapResult, 'action' | 'matchedDocPath' | 'confidence' | 'reason'> {
  if (bestMatch && bestMatch.similarity >= threshold) {
    return {
      action: 'update',
      matchedDocPath: bestMatch.filePath,
      confidence: bestMatch.similarity,
      reason: `Matched documentation above similarity threshold (${threshold})`,
    };
  }

  if (significance.isSignificant) {
    return {
      action: 'draft',
      confidence: bestMatch?.similarity ?? 0,
      reason: significance.reasons.join('; '),
    };
  }

  return {
    action: 'skip',
    confidence: bestMatch?.similarity ?? 0,
    reason: significance.reasons.join('; ') || 'No documentation match and change is minor',
  };
}

export async function mapDiffToDocs(
  options: MapDiffToDocsOptions,
): Promise<MapResult[]> {
  const cwd = options.cwd ?? process.cwd();
  const dbPath = path.resolve(cwd, options.config.index.dbPath);
  const store = options.store ?? openIndexStore(dbPath);
  const ownsStore = !options.store;
  const embedFn = options.embedFn ?? getEmbedding;
  const threshold = options.config.index.similarityThreshold;
  const topK = options.config.index.topK;

  try {
    const results: MapResult[] = [];

    for (const file of options.changedFiles) {
      const significance = assessSignificance(file, options.config);
      const query = buildRetrievalQuery({
        file,
        symbols: significance.symbols,
      });

      const queryEmbedding = await embedFn(
        query,
        options.config.index.embeddingModel,
      );

      const matches = store.searchByCosineDistance(queryEmbedding, topK);
      const bestMatch = matches[0];
      const actionResult = resolveAction(bestMatch, threshold, significance);

      results.push({
        file,
        ...actionResult,
        matchedChunks: toMatchedChunks(matches, threshold),
        query,
        isSignificant: significance.isSignificant,
      });
    }

    return results;
  } finally {
    if (ownsStore) {
      store.close();
    }
  }
}

export { cosineDistanceToSimilarity };
