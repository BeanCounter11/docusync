import { describe, expect, it } from 'vitest';
import {
  applyEnvOverrides,
  defaultConfig,
  docusyncConfigSchema,
  resolveConfig,
} from '../../src/config/schema.ts';

describe('docusyncConfigSchema', () => {
  it('accepts a valid partial configuration', () => {
    const result = docusyncConfigSchema.safeParse({
      llm: {
        provider: 'anthropic',
        model: 'claude-3-5-haiku-latest',
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown top-level keys', () => {
    const result = docusyncConfigSchema.safeParse({
      unknownKey: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid LLM providers', () => {
    const result = docusyncConfigSchema.safeParse({
      llm: {
        provider: 'invalid',
        model: 'test',
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('resolveConfig', () => {
  it('merges user values with defaults', () => {
    const config = resolveConfig({
      docs: {
        roots: ['documentation'],
        draftsDir: 'documentation/drafts',
      },
    });

    expect(config.docs.roots).toEqual(['documentation']);
    expect(config.index.embeddingModel).toBe(defaultConfig.index.embeddingModel);
    expect(config.llm.provider).toBe(defaultConfig.llm.provider);
  });
});

describe('applyEnvOverrides', () => {
  it('overrides the LLM provider from DOCUSYNC_LLM_PROVIDER', () => {
    const previous = process.env.DOCUSYNC_LLM_PROVIDER;
    process.env.DOCUSYNC_LLM_PROVIDER = 'ollama';

    try {
      const config = applyEnvOverrides(defaultConfig);
      expect(config.llm.provider).toBe('ollama');
    } finally {
      if (previous === undefined) {
        delete process.env.DOCUSYNC_LLM_PROVIDER;
      } else {
        process.env.DOCUSYNC_LLM_PROVIDER = previous;
      }
    }
  });
});
