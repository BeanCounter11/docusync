import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import os from 'node:os';
import path from 'node:path';

export const EMBEDDING_DIMENSIONS = 384;
const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;
let activeModelId = DEFAULT_MODEL_ID;

export function getModelsCacheDir(): string {
  return path.join(os.homedir(), '.docusync', 'models');
}

function configureModelEnvironment(modelId: string): void {
  env.cacheDir = getModelsCacheDir();
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  activeModelId = modelId;
}

async function createEmbedder(modelId: string): Promise<FeatureExtractionPipeline> {
  configureModelEnvironment(modelId);

  return pipeline('feature-extraction', modelId, {
    dtype: 'q8',
  });
}

export async function getEmbedder(
  modelId: string = DEFAULT_MODEL_ID,
): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise || activeModelId !== modelId) {
    embedderPromise = createEmbedder(modelId);
  }

  return embedderPromise;
}

function tensorToVector(tensor: {
  data: Float32Array | number[];
  dims?: number[];
}): number[] {
  const raw = Array.from(tensor.data as ArrayLike<number>);
  const dims = tensor.dims ?? [];

  if (dims.length === 2 && dims[0] === 1) {
    const vector = raw.slice(0, EMBEDDING_DIMENSIONS);
    return validateDimensions(vector);
  }

  if (raw.length === EMBEDDING_DIMENSIONS) {
    return validateDimensions(raw);
  }

  if (raw.length > EMBEDDING_DIMENSIONS) {
    return validateDimensions(raw.slice(0, EMBEDDING_DIMENSIONS));
  }

  throw new Error(
    `Unexpected embedding tensor shape [${dims.join(', ')}] with ${raw.length} values.`,
  );
}

export function validateDimensions(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected embedding vector of length ${EMBEDDING_DIMENSIONS}, received ${vector.length}.`,
    );
  }

  return vector;
}

export async function getEmbedding(
  text: string,
  modelId: string = DEFAULT_MODEL_ID,
): Promise<number[]> {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error('Cannot generate an embedding for empty text.');
  }

  const extractor = await getEmbedder(modelId);
  const output = await extractor(normalized, {
    pooling: 'mean',
    normalize: true,
  });

  return tensorToVector(output);
}

export function resetEmbedderForTests(): void {
  embedderPromise = null;
  activeModelId = DEFAULT_MODEL_ID;
}
