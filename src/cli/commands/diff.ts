import type { Command } from 'commander';

import { loadConfig } from '../../config/loader.js';

import {

  getChangedFiles,

  validateDiffModeOptions,

  type ChangedFile,

} from '../../git/diff-engine.js';

import { runDiffMapCommand, type DiffMapCommandOptions } from './diff-map.js';



export interface DiffCommandOptions extends DiffMapCommandOptions {}



function formatStatus(status: ChangedFile['status']): string {

  return status.padEnd(9);

}



function printTable(files: ChangedFile[]): void {

  if (files.length === 0) {

    console.log('No changed code files matched the diff filters.');

    return;

  }



  const header = [

    'PATH'.padEnd(40),

    'STATUS'.padEnd(10),

    '+LINES'.padStart(6),

    '-LINES'.padStart(6),

    'LANG'.padStart(12),

  ].join(' ');



  console.log(header);

  console.log('-'.repeat(header.length));



  for (const file of files) {

    const row = [

      file.path.padEnd(40),

      formatStatus(file.status),

      String(file.linesAdded).padStart(6),

      String(file.linesRemoved).padStart(6),

      (file.language ?? 'unknown').padStart(12),

    ].join(' ');



    console.log(row);

    console.log(`  hunks: ${file.hunks.length}`);

  }

}



export async function runDiffCommand(options: DiffCommandOptions): Promise<void> {

  if (options.map) {

    await runDiffMapCommand(options);

    return;

  }



  const { config } = await loadConfig({ configPath: options.config });

  const mode = validateDiffModeOptions(options);



  const files = await getChangedFiles({

    mode,

    ignorePatterns: config.docs.ignore ?? [],

  });



  if (options.json) {

    console.log(JSON.stringify({ mode, files }, null, 2));

    return;

  }



  const modeLabel =

    mode.type === 'staged'

      ? 'staged (--cached)'

      : `branch (${mode.base}...${mode.head})`;



  console.log(`DocuSync diff — ${modeLabel}`);

  console.log(`Ignored patterns: ${(config.docs.ignore ?? []).join(', ') || '(none)'}`);

  console.log('');



  printTable(files);

}



export function registerDiffCommand(program: Command): void {

  program

    .command('diff')

    .description(

      'Show changed code files from git diff (staged or base...head comparison)',

    )

    .option('--staged', 'Diff staged changes (git diff --cached)')

    .option('--base <ref>', 'Base ref for branch comparison')

    .option('--head <ref>', 'Head ref for branch comparison')

    .option('--map', 'Map changed files to documentation via local vector search')

    .option('--json', 'Output results as JSON')

    .action(async function (this: Command, flags: DiffCommandOptions) {

      const globalOpts = this.optsWithGlobals<{ config?: string }>();

      await runDiffCommand({

        ...flags,

        config: globalOpts.config,

      });

    });

}


