import { loadConfig } from '../../config/loader.js';
import {
  getChangedFiles,
  validateDiffModeOptions,
} from '../../git/diff-engine.js';
import { mapDiffToDocs, type MapResult } from '../../map/semantic-mapper.js';

export interface DiffMapCommandOptions {
  staged?: boolean;
  base?: string;
  head?: string;
  map?: boolean;
  json?: boolean;
  config?: string;
}

function formatAction(action: MapResult['action']): string {
  return action.toUpperCase();
}

function formatTarget(result: MapResult): string {
  if (result.action === 'update' && result.matchedDocPath) {
    return result.matchedDocPath;
  }

  if (result.action === 'draft') {
    return 'No match — significant change (draft)';
  }

  return 'No match — minor change';
}

export function printMapTable(results: MapResult[]): void {
  if (results.length === 0) {
    console.log('No changed code files to map.');
    return;
  }

  const header = [
    'SOURCE FILE'.padEnd(36),
    'ACTION'.padEnd(8),
    'MATCHED DOC / REASON'.padEnd(42),
    'CONF'.padStart(6),
  ].join(' ');

  console.log(header);
  console.log('-'.repeat(header.length + 4));

  for (const result of results) {
    const row = [
      result.file.path.padEnd(36),
      formatAction(result.action).padEnd(8),
      formatTarget(result).padEnd(42),
      result.confidence.toFixed(3).padStart(6),
    ].join(' ');

    console.log(row);

    if (result.matchedChunks.length > 0) {
      for (const chunk of result.matchedChunks.slice(0, 3)) {
        console.log(
          `  ↳ ${chunk.heading} (score ${chunk.score.toFixed(3)})`,
        );
      }
    } else if (result.action === 'draft') {
      console.log(`  ↳ ${result.reason}`);
    }
  }
}

export async function runDiffMapCommand(
  options: DiffMapCommandOptions,
): Promise<void> {
  const { config } = await loadConfig({ configPath: options.config });
  const mode = validateDiffModeOptions(options);

  const changedFiles = await getChangedFiles({
    mode,
    ignorePatterns: config.docs.ignore ?? [],
  });

  const results = await mapDiffToDocs({
    config,
    changedFiles,
  });

  if (options.json) {
    console.log(JSON.stringify({ mode, results }, null, 2));
    return;
  }

  const modeLabel =
    mode.type === 'staged'
      ? 'staged (--cached)'
      : `branch (${mode.base}...${mode.head})`;

  console.log(`DocuSync diff — semantic map (${modeLabel})`);
  console.log(
    `Similarity threshold: ${config.index.similarityThreshold} | topK: ${config.index.topK}`,
  );
  console.log('');

  printMapTable(results);
}
