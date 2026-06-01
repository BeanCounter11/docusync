import { cosmiconfig } from 'cosmiconfig';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  applyEnvOverrides,
  defaultConfig,
  docusyncConfigSchema,
  resolveConfig,
  type DocuSyncConfig,
} from './schema.js';

export interface LoadedConfig {
  config: DocuSyncConfig;
  filepath: string | null;
}

const explorer = cosmiconfig('docusync', {
  searchPlaces: [
    'docusync.json',
    '.docusyncrc',
    '.docusyncrc.json',
    '.docusyncrc.yaml',
    '.docusyncrc.yml',
  ],
});

async function loadFromPath(configPath: string): Promise<LoadedConfig> {
  const absolutePath = path.resolve(configPath);
  const raw = await readFile(absolutePath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const validated = docusyncConfigSchema.parse(parsed);

  return {
    config: applyEnvOverrides(resolveConfig(validated)),
    filepath: absolutePath,
  };
}

export async function loadConfig(options?: {
  configPath?: string;
  searchFrom?: string;
}): Promise<LoadedConfig> {
  if (options?.configPath) {
    return loadFromPath(options.configPath);
  }

  const result = await explorer.search(options?.searchFrom);

  if (!result || result.isEmpty) {
    return {
      config: applyEnvOverrides(defaultConfig),
      filepath: null,
    };
  }

  const validated = docusyncConfigSchema.parse(result.config);

  return {
    config: applyEnvOverrides(resolveConfig(validated)),
    filepath: result.filepath,
  };
}

export function isDryRunEnabled(explicitFlag?: boolean): boolean {
  if (explicitFlag !== undefined) {
    return explicitFlag;
  }

  return process.env.DOCUSYNC_DRY_RUN === '1';
}
