import type { Command } from 'commander';
import { isDryRunEnabled, loadConfig } from '../../config/loader.js';
import { validateDiffModeOptions } from '../../git/diff-engine.js';
import { runPipeline } from '../../pipeline/run.js';

export interface RunCommandOptions {
  staged?: boolean;
  base?: string;
  head?: string;
  dryRun?: boolean;
  backup?: boolean;
  json?: boolean;
  config?: string;
}

export async function runRunCommand(options: RunCommandOptions): Promise<void> {
  const { config, filepath } = await loadConfig({ configPath: options.config });
  const dryRun = isDryRunEnabled(options.dryRun);
  const diffMode = validateDiffModeOptions(options);

  if (!options.json) {
    console.log('DocuSync — documentation sync pipeline');
    if (filepath) {
      console.log(`Config: ${filepath}`);
    }

    if (dryRun) {
      console.log('Mode: dry-run (no files will be written)');
    }
  }

  const result = await runPipeline({
    config,
    dryRun,
    backup: options.backup,
    diffMode,
    silent: options.json,
    generateObjectFn: undefined,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  }
}

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description(
      'Run the full pipeline: diff → map → LLM → write documentation updates or drafts',
    )
    .option('--staged', 'Diff staged changes (git diff --cached)')
    .option('--base <ref>', 'Base ref for branch comparison')
    .option('--head <ref>', 'Head ref for branch comparison')
    .option('--dry-run', 'Preview writes without modifying files')
    .option('--backup', 'Create .md.bak backups before overwriting docs')
    .option('--json', 'Output pipeline results as JSON')
    .action(async function (this: Command, flags: RunCommandOptions) {
      const globalOpts = this.optsWithGlobals<{ config?: string }>();
      await runRunCommand({
        ...flags,
        config: globalOpts.config,
      });
    });
}
