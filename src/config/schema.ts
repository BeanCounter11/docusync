import { z } from 'zod';

export const llmProviderSchema = z.enum(['openai', 'anthropic', 'ollama']);

export const docsConfigSchema = z.object({
  roots: z.array(z.string().min(1)).min(1),
  draftsDir: z.string().min(1),
  ignore: z.array(z.string()).optional(),
});

export const indexConfigSchema = z.object({
  dbPath: z.string().min(1),
  embeddingModel: z.string().min(1),
  chunkMaxTokens: z.number().int().min(64).max(8192).optional(),
  topK: z.number().int().min(1).max(50).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
});

export const llmConfigSchema = z.object({
  provider: llmProviderSchema,
  model: z.string().min(1),
  maxTokens: z.number().int().min(256).max(128_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const significanceConfigSchema = z.object({
  minLinesChanged: z.number().int().min(0).optional(),
  minFilesChanged: z.number().int().min(1).optional(),
  includeGlobs: z.array(z.string()).optional(),
  excludeGlobs: z.array(z.string()).optional(),
});

export const gitConfigSchema = z.object({
  commitMessage: z.string().min(1).optional(),
  authorName: z.string().min(1).optional(),
  authorEmail: z.string().email().optional(),
});

export const githubConfigSchema = z.object({
  commentOnDraft: z.boolean().optional(),
  commentOnUpdate: z.boolean().optional(),
});

export const ollamaConfigSchema = z.object({
  baseUrl: z.string().url().optional(),
});

export const docusyncConfigSchema = z
  .object({
    $schema: z.string().optional(),
    docs: docsConfigSchema.optional(),
    index: indexConfigSchema.optional(),
    llm: llmConfigSchema.optional(),
    ollama: ollamaConfigSchema.optional(),
    significance: significanceConfigSchema.optional(),
    git: gitConfigSchema.optional(),
    github: githubConfigSchema.optional(),
    backup: z.boolean().optional(),
  })
  .strict();

export type LlmProvider = z.infer<typeof llmProviderSchema>;
export type DocsConfig = z.infer<typeof docsConfigSchema>;
export type IndexConfig = z.infer<typeof indexConfigSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;
export type SignificanceConfig = z.infer<typeof significanceConfigSchema>;
export type GitConfig = z.infer<typeof gitConfigSchema>;
export type GithubConfig = z.infer<typeof githubConfigSchema>;
export type OllamaConfig = z.infer<typeof ollamaConfigSchema>;
export type DocuSyncConfigInput = z.infer<typeof docusyncConfigSchema>;

export interface DocuSyncConfig {
  docs: DocsConfig;
  index: Required<IndexConfig>;
  llm: Required<LlmConfig>;
  ollama: Required<OllamaConfig>;
  significance: Required<SignificanceConfig>;
  git: Required<GitConfig>;
  github: Required<GithubConfig>;
  backup: boolean;
}

export const defaultConfig: DocuSyncConfig = {
  docs: {
    roots: ['docs'],
    draftsDir: 'docs/drafts',
    ignore: ['docs/drafts/**', 'node_modules/**', '**/*.md'],
  },
  index: {
    dbPath: '.docusync/index.db',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    chunkMaxTokens: 512,
    topK: 5,
    similarityThreshold: 0.55,
  },
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.2,
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
  },
  significance: {
    minLinesChanged: 15,
    minFilesChanged: 1,
    includeGlobs: ['src/**', 'lib/**', 'packages/**'],
    excludeGlobs: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
  },
  git: {
    commitMessage: 'docs: auto-update via DocuSync [skip ci]',
    authorName: 'github-actions[bot]',
    authorEmail: '41898282+github-actions[bot]@users.noreply.github.com',
  },
  github: {
    commentOnDraft: true,
    commentOnUpdate: false,
  },
  backup: false,
};

function mergeSection<T extends object>(
  defaults: T,
  overrides: Partial<T> | undefined,
): T {
  return overrides ? { ...defaults, ...overrides } : defaults;
}

export function resolveConfig(input: DocuSyncConfigInput): DocuSyncConfig {
  const parsed = docusyncConfigSchema.parse(input);

  return {
    docs: mergeSection(defaultConfig.docs, parsed.docs),
    index: mergeSection(defaultConfig.index, parsed.index) as Required<IndexConfig>,
    llm: mergeSection(defaultConfig.llm, parsed.llm) as Required<LlmConfig>,
    ollama: mergeSection(defaultConfig.ollama, parsed.ollama) as Required<OllamaConfig>,
    significance: mergeSection(
      defaultConfig.significance,
      parsed.significance,
    ) as Required<SignificanceConfig>,
    git: mergeSection(defaultConfig.git, parsed.git) as Required<GitConfig>,
    github: mergeSection(defaultConfig.github, parsed.github) as Required<GithubConfig>,
    backup: parsed.backup ?? defaultConfig.backup,
  };
}

export function applyEnvOverrides(config: DocuSyncConfig): DocuSyncConfig {
  const provider = process.env.DOCUSYNC_LLM_PROVIDER;

  if (!provider) {
    return config;
  }

  const parsedProvider = llmProviderSchema.safeParse(provider);
  if (!parsedProvider.success) {
    throw new Error(
      `Invalid DOCUSYNC_LLM_PROVIDER "${provider}". Expected one of: openai, anthropic, ollama.`,
    );
  }

  return {
    ...config,
    llm: {
      ...config.llm,
      provider: parsedProvider.data,
    },
  };
}
