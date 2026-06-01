import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { indexDocuments } from '../../index/indexer.js';

export interface IndexDocsCommandOptions {
  config?: string;
  force?: boolean;
  json?: boolean;
}

export async function runIndexDocsCommand(
  options: IndexDocsCommandOptions,
): Promise<void> {
  const { config, filepath } = await loadConfig({
    configPath: options.config,
  });

  console.log('DocuSync — indexing documentation');
  if (filepath) {
    console.log(`Config: ${filepath}`);
  }

  console.log(`Docs roots: ${config.docs.roots.join(', ')}`);
  console.log(`Index database: ${config.index.dbPath}`);
  console.log(`Embedding model: ${config.index.embeddingModel}`);
  console.log('');

  const stats = await indexDocuments({
    config,
    force: options.force,
  });

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log('Indexing complete');
  console.log(`  Files scanned:        ${stats.filesScanned}`);
  console.log(`  Files skipped (cache): ${stats.filesSkipped}`);
  console.log(`  Files re-indexed:     ${stats.filesReindexed}`);
  console.log(`  Files removed:        ${stats.filesRemoved}`);
  console.log(`  Vectors embedded:     ${stats.chunksEmbedded}`);
  console.log(`  Vectors from cache:   ${stats.chunksFromCache}`);
  console.log(`  Total chunks in DB:   ${stats.totalChunks}`);
}

export function registerIndexDocsCommand(program: Command): void {
  program
    .command('index-docs')
    .description('Build or update the local documentation embedding index')
    .option('--force', 'Re-embed all files even when file hash is unchanged')
    .option('--json', 'Output indexing statistics as JSON')
    .action(async function (this: Command, flags: IndexDocsCommandOptions) {
      const globalOpts = this.optsWithGlobals<{ config?: string }>();
      await runIndexDocsCommand({
        ...flags,
        config: globalOpts.config,
      });
    });
}
