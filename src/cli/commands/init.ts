import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { stripJsonComments } from '../../utils/jsonc.js';
import { logInfo } from '../../utils/logger.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(
  moduleDir,
  '../../../templates/docusync.json.example',
);

export async function runInitCommand(targetPath = 'docusync.json'): Promise<void> {
  const destination = path.resolve(process.cwd(), targetPath);

  try {
    await access(destination);
    throw new Error(
      `${targetPath} already exists. Remove it first or choose another path.`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }
  }

  const template = await readFile(templatePath, 'utf-8');
  const json = stripJsonComments(template);
  JSON.parse(json);
  await writeFile(destination, `${JSON.stringify(JSON.parse(json), null, 2)}\n`, 'utf-8');
  logInfo(`Created ${targetPath} from templates/docusync.json.example`);
  logInfo('Open the file in VS Code for schema-backed autocomplete and tooltips.');
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create a starter docusync.json from the project template')
    .option('-o, --output <path>', 'Output path', 'docusync.json')
    .action(async (options: { output: string }) => {
      await runInitCommand(options.output);
    });
}
