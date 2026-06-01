import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../src/config/schema.ts';
import type { DocuSyncConfig } from '../../../src/config/schema.ts';
import {
  buildDraftDocUserPrompt,
  DRAFT_DOC_SYSTEM_PROMPT,
} from '../../../src/llm/prompts/draft-doc.ts';
import {
  buildUpdateDocUserPrompt,
  UPDATE_DOC_SYSTEM_PROMPT,
} from '../../../src/llm/prompts/update-doc.ts';
import {
  CONFIDENCE_THRESHOLD,
  DraftDocSchema,
  executeDocDraft,
  executeDocUpdate,
  UpdateDocSchema,
} from '../../../src/llm/orchestrator.ts';
import { getLLMModel } from '../../../src/llm/providers.ts';

const mockModel = { modelId: 'mock-model' };

describe('UpdateDocSchema', () => {
  it('rejects invalid confidence values', () => {
    const result = UpdateDocSchema.safeParse({
      updatedMarkdown: '# Doc',
      changeSummary: 'Updated intro',
      confidence: 1.5,
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid structured update payloads', () => {
    const result = UpdateDocSchema.safeParse({
      updatedMarkdown: '# Doc\n\nUpdated body.',
      changeSummary: 'Refreshed API section',
      confidence: 0.85,
    });

    expect(result.success).toBe(true);
  });
});

describe('DraftDocSchema', () => {
  it('requires draft markdown and metadata fields', () => {
    const result = DraftDocSchema.safeParse({
      draftMarkdown: '# Billing\n\nGuide body.',
      suggestedTitle: 'Billing Module',
      rationale: 'New billing feature added without existing docs.',
    });

    expect(result.success).toBe(true);
  });
});

describe('prompt builders', () => {
  it('includes full markdown and diff context for updates', () => {
    const prompt = buildUpdateDocUserPrompt({
      docPath: 'docs/auth.md',
      targetMarkdown: '# Auth\n\nOld content.',
      codeDiff: '+export function authenticate() {}',
      matchedSection: '## Middleware',
    });

    expect(prompt).toContain('docs/auth.md');
    expect(prompt).toContain('# Auth');
    expect(prompt).toContain('export function authenticate');
    expect(prompt).toContain('## Middleware');
  });

  it('includes source path and diff for draft prompts', () => {
    const prompt = buildDraftDocUserPrompt({
      sourceFilePath: 'src/billing/invoice.ts',
      codeDiff: '+export function createInvoice() {}',
      projectContext: 'Monorepo payment service',
    });

    expect(prompt).toContain('src/billing/invoice.ts');
    expect(prompt).toContain('createInvoice');
    expect(prompt).toContain('Monorepo payment service');
  });

  it('uses expert writer system instructions', () => {
    expect(UPDATE_DOC_SYSTEM_PROMPT).toContain('expert technical writer');
    expect(DRAFT_DOC_SYSTEM_PROMPT).toContain('onboarding technical writer');
  });
});

describe('getLLMModel', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('throws when OpenAI is selected without OPENAI_API_KEY', () => {
    delete process.env.OPENAI_API_KEY;

    const config: DocuSyncConfig = {
      ...defaultConfig,
      llm: { ...defaultConfig.llm, provider: 'openai' },
    };

    expect(() => getLLMModel(config)).toThrow(/OPENAI_API_KEY/);
  });

  it('throws when Anthropic is selected without ANTHROPIC_API_KEY', () => {
    delete process.env.ANTHROPIC_API_KEY;

    const config: DocuSyncConfig = {
      ...defaultConfig,
      llm: { ...defaultConfig.llm, provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
    };

    expect(() => getLLMModel(config)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('returns a model for Ollama without API keys', () => {
    const config: DocuSyncConfig = {
      ...defaultConfig,
      llm: { ...defaultConfig.llm, provider: 'ollama', model: 'llama3.2' },
      ollama: { baseUrl: 'http://localhost:11434' },
    };

    const model = getLLMModel(config);
    expect(model).toBeDefined();
  });
});

describe('executeDocUpdate', () => {
  const config = defaultConfig;

  it('returns success when confidence meets threshold', async () => {
    const generateObjectFn = vi.fn().mockResolvedValue({
      object: {
        updatedMarkdown: '# Auth\n\nUpdated.',
        changeSummary: 'Synced middleware section',
        confidence: 0.9,
      },
    });

    const result = await executeDocUpdate({
      config,
      docPath: 'docs/auth.md',
      targetMarkdown: '# Auth\n\nOld.',
      codeDiff: '+export function authenticate() {}',
      generateObjectFn,
      model: mockModel as never,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updatedMarkdown).toContain('Updated');
    }

    expect(generateObjectFn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        schema: UpdateDocSchema,
        system: UPDATE_DOC_SYSTEM_PROMPT,
        temperature: config.llm.temperature,
        maxTokens: config.llm.maxTokens,
      }),
    );
  });

  it('returns failure when confidence is below threshold', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await executeDocUpdate({
      config,
      docPath: 'docs/auth.md',
      targetMarkdown: '# Auth',
      codeDiff: 'diff',
      generateObjectFn: vi.fn().mockResolvedValue({
        object: {
          updatedMarkdown: '# Auth\n\nMaybe wrong.',
          changeSummary: 'Uncertain edits',
          confidence: 0.4,
        },
      }),
      model: mockModel as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.confidence).toBe(0.4);
      expect(result.reason).toContain(String(CONFIDENCE_THRESHOLD));
    }

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns failure when generateObject throws', async () => {
    const result = await executeDocUpdate({
      config,
      docPath: 'docs/auth.md',
      targetMarkdown: '# Auth',
      codeDiff: 'diff',
      generateObjectFn: vi.fn().mockRejectedValue(new Error('API unavailable')),
      model: mockModel as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('API unavailable');
    }
  });
});

describe('executeDocDraft', () => {
  const config = defaultConfig;

  it('returns structured draft content from generateObject', async () => {
    const generateObjectFn = vi.fn().mockResolvedValue({
      object: {
        draftMarkdown: '# Billing\n\nUsage guide.',
        suggestedTitle: 'Billing Module Guide',
        rationale: 'New billing module requires onboarding docs.',
      },
    });

    const result = await executeDocDraft({
      config,
      sourceFilePath: 'src/billing.ts',
      codeDiff: '+export function createInvoice() {}',
      generateObjectFn,
      model: mockModel as never,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestedTitle).toBe('Billing Module Guide');
    }

    expect(generateObjectFn).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: DraftDocSchema,
        system: DRAFT_DOC_SYSTEM_PROMPT,
      }),
    );
  });
});
