#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { configureLogger, logDebug, logInfo } from '../utils/logger.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerIndexDocsCommand } from './commands/index-docs.js';
import { registerInitCommand } from './commands/init.js';
import { registerRunCommand } from './commands/run.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(moduleDir, '../../package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
  version: string;
};

const program = new Command();

program
  .name('docusync')
  .description('Sync documentation with code changes using local embeddings and LLM')
  .version(pkg.version, '-V, --version', 'Print the current version')
  .option('-c, --config <path>', 'Path to docusync.json')
  .option('--verbose', 'Enable debug logging (or set DOCUSYNC_VERBOSE=1)')
  .hook('preAction', (thisCommand) => {
    const globalOpts = thisCommand.optsWithGlobals<{
      verbose?: boolean;
    }>();
    configureLogger({
      verbose:
        globalOpts.verbose === true || process.env.DOCUSYNC_VERBOSE === '1',
    });
  });

registerDiffCommand(program);
registerIndexDocsCommand(program);
registerRunCommand(program);
registerInitCommand(program);

program.action(async function (this: Command) {
  const options = this.opts<{ config?: string }>();
  const { config, filepath } = await loadConfig({
    configPath: options.config,
  });

  logInfo(`docusync v${pkg.version}`);

  if (filepath) {
    logInfo(`Config loaded from ${filepath}`);
  } else {
    logInfo('Using default configuration (no docusync.json found)');
  }

  logDebug('Resolved configuration', { config });
});

await program.parseAsync(process.argv);
