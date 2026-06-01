import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import type { DocuSyncConfig } from '../config/schema.js';
import { chunkMarkdown, hashFileContent, type MarkdownChunk } from './chunker.js';
import { getEmbedding } from './embedder.js';
import { openIndexStore, type IndexStore } from './store.js';

export interface IndexRunStats {
  filesScanned: number;
  filesSkipped: number;
  filesReindexed: number;
  filesRemoved: number;
  chunksEmbedded: number;
  chunksFromCache: number;
  totalChunks: number;
}

export type EmbedFn = (text: string, modelId: string) => Promise<number[]>;

export interface IndexDocumentsOptions {
  config: DocuSyncConfig;
  cwd?: string;
  force?: boolean;
  /** Injectable embedder (used by tests to avoid loading ML models). */
  embedFn?: EmbedFn;
}

const MARKDOWN_EXTENSION = '.md';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function getIndexerIgnorePatterns(config: DocuSyncConfig): string[] {
  const patterns = config.docs.ignore ?? [];
  const withoutMarkdownGlob = patterns.filter((pattern) => pattern !== '**/*.md');
  const draftsPattern = `${normalizePath(config.docs.draftsDir)}/**`;

  return [...new Set([...withoutMarkdownGlob, draftsPattern])];
}

export function shouldIgnoreIndexerPath(
  relativePath: string,
  ignorePatterns: string[],
): boolean {
  const normalized = normalizePath(relativePath);
  return ignorePatterns.some((pattern) =>
    minimatch(normalized, pattern, { dot: true, matchBase: true }),
  );
}

async function collectMarkdownFiles(
  cwd: string,
  docsRoot: string,
  ignorePatterns: string[],
): Promise<string[]> {
  const absoluteRoot = path.resolve(cwd, docsRoot);
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;

    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizePath(path.relative(cwd, absolutePath));

      if (entry.isDirectory()) {
        if (
          shouldIgnoreIndexerPath(relativePath, ignorePatterns) ||
          shouldIgnoreIndexerPath(`${relativePath}/**`, ignorePatterns)
        ) {
          continue;
        }

        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(MARKDOWN_EXTENSION)) {
        continue;
      }

      if (shouldIgnoreIndexerPath(relativePath, ignorePatterns)) {
        continue;
      }

      files.push(absolutePath);
    }
  }

  await walk(absoluteRoot);
  return files.sort((a, b) => a.localeCompare(b));
}

async function indexChunk(
  store: IndexStore,
  chunk: MarkdownChunk,
  modelId: string,
  stats: IndexRunStats,
  embedFn: EmbedFn,
): Promise<void> {
  const cached = store.findCachedChunkByHash(chunk.contentHash);
  let embedding: number[];

  if (cached) {
    const existing = store.getChunkEmbedding(cached.id);
    if (existing) {
      embedding = existing;
      stats.chunksFromCache += 1;
    } else {
      embedding = await embedFn(chunk.content, modelId);
      stats.chunksEmbedded += 1;
    }
  } else {
    embedding = await embedFn(chunk.content, modelId);
    stats.chunksEmbedded += 1;
  }

  store.insertChunk(
    {
      filePath: chunk.filePath,
      heading: chunk.heading,
      textContent: chunk.content,
      contentHash: chunk.contentHash,
    },
    embedding,
  );
}

async function reindexFile(
  store: IndexStore,
  absolutePath: string,
  relativePath: string,
  config: DocuSyncConfig,
  stats: IndexRunStats,
  embedFn: EmbedFn,
): Promise<void> {
  const markdown = await readFile(absolutePath, 'utf-8');
  const fileHash = hashFileContent(markdown);
  const maxChars = Math.max(
    500,
    (config.index.chunkMaxTokens ?? 512) * 4,
  );

  store.deleteChunksForFile(relativePath);
  const chunks = chunkMarkdown(relativePath, markdown, { maxChars });

  for (const chunk of chunks) {
    await indexChunk(store, chunk, config.index.embeddingModel, stats, embedFn);
  }

  store.upsertIndexedFile(relativePath, fileHash);
  stats.filesReindexed += 1;
}

export async function indexDocuments(
  options: IndexDocumentsOptions,
): Promise<IndexRunStats> {
  const cwd = options.cwd ?? process.cwd();
  const dbPath = path.resolve(cwd, options.config.index.dbPath);
  const store = openIndexStore(dbPath);
  const ignorePatterns = getIndexerIgnorePatterns(options.config);
  const embedFn = options.embedFn ?? getEmbedding;

  const stats: IndexRunStats = {
    filesScanned: 0,
    filesSkipped: 0,
    filesReindexed: 0,
    filesRemoved: 0,
    chunksEmbedded: 0,
    chunksFromCache: 0,
    totalChunks: 0,
  };

  try {
    const discoveredFiles = new Set<string>();

    for (const docsRoot of options.config.docs.roots) {
      const absoluteRoot = path.resolve(cwd, docsRoot);

      try {
        const rootStat = await stat(absoluteRoot);
        if (!rootStat.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      const markdownFiles = await collectMarkdownFiles(
        cwd,
        docsRoot,
        ignorePatterns,
      );

      for (const absolutePath of markdownFiles) {
        const relativePath = normalizePath(
          path.relative(cwd, absolutePath),
        );
        discoveredFiles.add(relativePath);
        stats.filesScanned += 1;

        const markdown = await readFile(absolutePath, 'utf-8');
        const fileHash = hashFileContent(markdown);
        const indexed = store.getIndexedFile(relativePath);

        if (
          !options.force &&
          indexed &&
          indexed.contentHash === fileHash
        ) {
          stats.filesSkipped += 1;
          continue;
        }

        await reindexFile(
          store,
          absolutePath,
          relativePath,
          options.config,
          stats,
          embedFn,
        );
      }
    }

    const indexedPaths = store.listIndexedFilePaths();
    for (const indexedPath of indexedPaths) {
      if (!discoveredFiles.has(indexedPath)) {
        store.removeIndexedFile(indexedPath);
        stats.filesRemoved += 1;
      }
    }

    stats.totalChunks = store.getChunkCount();
    return stats;
  } finally {
    store.close();
  }
}
