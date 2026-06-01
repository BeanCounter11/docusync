import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import * as sqliteVec from 'sqlite-vec';
import { EMBEDDING_DIMENSIONS, validateDimensions } from './embedder.js';

export interface ChunkMetaRecord {
  id: number;
  filePath: string;
  heading: string;
  textContent: string;
  contentHash: string;
  updatedAt: string;
}

export interface ChunkInsertInput {
  filePath: string;
  heading: string;
  textContent: string;
  contentHash: string;
}

export interface SimilarChunkResult {
  chunkId: number;
  filePath: string;
  heading: string;
  textContent: string;
  contentHash: string;
  distance: number;
  similarity: number;
}

export interface IndexedFileRecord {
  filePath: string;
  contentHash: string;
  updatedAt: string;
}

export class IndexStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  static open(dbPath: string): IndexStore {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }

    const db = new Database(dbPath);
    sqliteVec.load(db);

    const store = new IndexStore(db);
    store.initSchema();
    return store;
  }

  initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks_meta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        heading TEXT NOT NULL,
        text_content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_meta_file_path
        ON chunks_meta(file_path);

      CREATE INDEX IF NOT EXISTS idx_chunks_meta_content_hash
        ON chunks_meta(content_hash);

      CREATE TABLE IF NOT EXISTS indexed_files (
        file_path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding FLOAT[${EMBEDDING_DIMENSIONS}]
      );
    `);
  }

  getIndexedFile(filePath: string): IndexedFileRecord | null {
    const row = this.db
      .prepare(
        `SELECT file_path as filePath, content_hash as contentHash, updated_at as updatedAt
         FROM indexed_files WHERE file_path = ?`,
      )
      .get(filePath) as IndexedFileRecord | undefined;

    return row ?? null;
  }

  upsertIndexedFile(filePath: string, contentHash: string): void {
    this.db
      .prepare(
        `INSERT INTO indexed_files (file_path, content_hash, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(file_path) DO UPDATE SET
           content_hash = excluded.content_hash,
           updated_at = datetime('now')`,
      )
      .run(filePath, contentHash);
  }

  listIndexedFilePaths(): string[] {
    const rows = this.db
      .prepare(`SELECT file_path as filePath FROM indexed_files`)
      .all() as Array<{ filePath: string }>;

    return rows.map((row) => row.filePath);
  }

  removeIndexedFile(filePath: string): void {
    this.deleteChunksForFile(filePath);
    this.db.prepare(`DELETE FROM indexed_files WHERE file_path = ?`).run(filePath);
  }

  getChunkIdsForFile(filePath: string): number[] {
    const rows = this.db
      .prepare(`SELECT id FROM chunks_meta WHERE file_path = ?`)
      .all(filePath) as Array<{ id: number }>;

    return rows.map((row) => row.id);
  }

  deleteChunksForFile(filePath: string): void {
    const chunkIds = this.getChunkIdsForFile(filePath);

    const deleteVector = this.db.prepare(
      `DELETE FROM chunks_vec WHERE chunk_id = ?`,
    );
    const deleteMeta = this.db.prepare(`DELETE FROM chunks_meta WHERE id = ?`);

    const removeChunks = this.db.transaction((ids: number[]) => {
      for (const id of ids) {
        deleteVector.run(BigInt(id));
        deleteMeta.run(id);
      }
    });

    removeChunks(chunkIds);
  }

  insertChunk(input: ChunkInsertInput, embedding: number[]): number {
    const vector = validateDimensions(embedding);
    const embeddingBuffer = new Float32Array(vector);

    const insertMeta = this.db.prepare(
      `INSERT INTO chunks_meta (file_path, heading, text_content, content_hash, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    );

    const insertVector = this.db.prepare(
      `INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`,
    );

    const insert = this.db.transaction(() => {
      const result = insertMeta.run(
        input.filePath,
        input.heading,
        input.textContent,
        input.contentHash,
      );
      const rawId = result.lastInsertRowid;
      const chunkId =
        typeof rawId === 'bigint' ? Number(rawId) : Number(rawId);

      if (!Number.isSafeInteger(chunkId) || chunkId <= 0) {
        throw new Error(`Invalid chunk id generated for vector insert: ${String(rawId)}`);
      }

      insertVector.run(BigInt(chunkId), embeddingBuffer);
      return chunkId;
    });

    return insert();
  }

  getChunkById(chunkId: number): ChunkMetaRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, file_path as filePath, heading, text_content as textContent,
                content_hash as contentHash, updated_at as updatedAt
         FROM chunks_meta WHERE id = ?`,
      )
      .get(chunkId) as ChunkMetaRecord | undefined;

    return row ?? null;
  }

  getChunkEmbedding(chunkId: number): number[] | null {
    const row = this.db
      .prepare(`SELECT embedding FROM chunks_vec WHERE chunk_id = ?`)
      .get(chunkId) as { embedding: Buffer } | undefined;

    if (!row?.embedding) {
      return null;
    }

    const bytes = row.embedding;
    const floats = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );

    return validateDimensions(Array.from(floats));
  }

  findCachedChunkByHash(contentHash: string): ChunkMetaRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, file_path as filePath, heading, text_content as textContent,
                content_hash as contentHash, updated_at as updatedAt
         FROM chunks_meta WHERE content_hash = ?
         LIMIT 1`,
      )
      .get(contentHash) as ChunkMetaRecord | undefined;

    return row ?? null;
  }

  searchSimilar(
    queryEmbedding: number[],
    topK: number,
  ): SimilarChunkResult[] {
    return this.searchByCosineDistance(queryEmbedding, topK);
  }

  /**
   * k-NN search using sqlite-vec cosine distance.
   * Similarity score is computed as `1.0 - vec_distance_cosine(...)`.
   */
  searchByCosineDistance(
    queryEmbedding: number[],
    topK: number,
  ): SimilarChunkResult[] {
    const vector = new Float32Array(validateDimensions(queryEmbedding));

    const rows = this.db
      .prepare(
        `SELECT
           cm.id as chunkId,
           cm.file_path as filePath,
           cm.heading,
           cm.text_content as textContent,
           cm.content_hash as contentHash,
           vec_distance_cosine(cv.embedding, ?) AS distance
         FROM chunks_vec cv
         INNER JOIN chunks_meta cm ON cm.id = cv.chunk_id
         ORDER BY distance ASC
         LIMIT ?`,
      )
      .all(vector, topK) as Array<
        Omit<SimilarChunkResult, 'similarity'> & { distance: number }
      >;

    return rows.map((row) => ({
      ...row,
      similarity: cosineDistanceToSimilarity(row.distance),
    }));
  }

  getChunkCount(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM chunks_meta`)
      .get() as { count: number };

    return row.count;
  }

  close(): void {
    this.db.close();
  }
}

export function cosineDistanceToSimilarity(distance: number): number {
  const similarity = 1 - distance;
  return Math.max(0, Math.min(1, similarity));
}

export function openIndexStore(dbPath: string): IndexStore {
  return IndexStore.open(dbPath);
}
