import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import type { DocuSyncConfig } from '../config/schema.js';

function requireEnv(name: string, providerLabel: string): string {
  const value = process.env[name];

  if (!value?.trim()) {
    throw new Error(
      `${providerLabel} requires the ${name} environment variable. ` +
        `Set ${name} in your shell or CI secrets before running DocuSync.`,
    );
  }

  return value.trim();
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function resolveOllamaBaseUrl(config: DocuSyncConfig): string {
  return (
    process.env.OLLAMA_BASE_URL?.trim() ||
    config.ollama.baseUrl ||
    'http://localhost:11434'
  );
}

/**
 * Returns an AI SDK language model for the configured LLM provider.
 */
export function getLLMModel(config: DocuSyncConfig): LanguageModel {
  const modelId = config.llm.model;

  switch (config.llm.provider) {
    case 'openai': {
      requireEnv('OPENAI_API_KEY', 'OpenAI');
      return openai(modelId);
    }

    case 'anthropic': {
      requireEnv('ANTHROPIC_API_KEY', 'Anthropic');
      return anthropic(modelId);
    }

    case 'ollama': {
      const ollama = createOllama({
        baseURL: normalizeOllamaBaseUrl(resolveOllamaBaseUrl(config)),
      });

      return ollama(modelId);
    }

    default: {
      const exhaustive: never = config.llm.provider;
      throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`);
    }
  }
}
