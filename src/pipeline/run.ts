import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocuSyncConfig } from '../config/schema.js';
import { isDryRunEnabled } from '../config/loader.js';
import {
  getChangedFiles,
  validateDiffModeOptions,
  type DiffMode,
} from '../git/diff-engine.js';
import { formatChangedFileAsDiff } from '../git/format-diff.js';
import type { EmbedFn } from '../index/indexer.js';
import type { LanguageModel } from 'ai';
import { executeDocDraft, executeDocUpdate, type GenerateObjectFn } from '../llm/orchestrator.js';
import { mapDiffToDocs } from '../map/semantic-mapper.js';
import { printPipelineSummary } from '../notify/cli-notifier.js';
import { createDraftDoc } from '../write/draft-writer.js';
import { updateExistingDoc } from '../write/doc-writer.js';
import type { PipelineItemResult, PipelineRunResult } from './types.js';

export type { PipelineItemResult, PipelineRunResult } from './types.js';

export interface RunPipelineOptions {
  config: DocuSyncConfig;
  cwd?: string;
  dryRun?: boolean;
  backup?: boolean;
  diffMode?: DiffMode;
  staged?: boolean;
  base?: string;
  head?: string;
  embedFn?: EmbedFn;
  generateObjectFn?: GenerateObjectFn;
  model?: LanguageModel;
  silent?: boolean;
}

function countSyncedLines(original: string, updated: string): number {
  const originalLines = original.split('\n').length;
  const updatedLines = updated.split('\n').length;
  return Math.abs(updatedLines - originalLines);
}

async function readDocContent(
  docPath: string,
  cwd: string,
): Promise<string> {
  const absolutePath = path.resolve(cwd, docPath);

  try {
    return await readFile(absolutePath, 'utf-8');
  } catch {
    return '';
  }
}

export async function runPipeline(
  options: RunPipelineOptions,
): Promise<PipelineRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = isDryRunEnabled(options.dryRun);
  const backup = options.backup ?? options.config.backup;

  const diffMode =
    options.diffMode ??
    validateDiffModeOptions({
      staged: options.staged,
      base: options.base,
      head: options.head,
    });

  const changedFiles = await getChangedFiles({
    mode: diffMode,
    ignorePatterns: options.config.docs.ignore ?? [],
    cwd,
  });

  const mapResults = await mapDiffToDocs({
    config: options.config,
    changedFiles,
    cwd,
    embedFn: options.embedFn,
  });

  const items: PipelineItemResult[] = [];

  for (const mapResult of mapResults) {
    const codeDiff = formatChangedFileAsDiff(mapResult.file);

    if (mapResult.action === 'skip') {
      items.push({ mapResult, status: 'skipped' });
      continue;
    }

    if (mapResult.action === 'update' && mapResult.matchedDocPath) {
      const docPath = mapResult.matchedDocPath;
      const targetMarkdown = await readDocContent(docPath, cwd);
      const matchedSection = mapResult.matchedChunks
        .map((chunk) => chunk.text)
        .join('\n\n');

      const llmResult = await executeDocUpdate({
        config: options.config,
        docPath,
        targetMarkdown,
        codeDiff,
        matchedSection,
        generateObjectFn: options.generateObjectFn,
        model: options.model,
      });

      if (!llmResult.success) {
        items.push({
          mapResult,
          status: 'failed',
          message: llmResult.reason,
        });
        continue;
      }

      const linesSynced = countSyncedLines(
        targetMarkdown,
        llmResult.data.updatedMarkdown,
      );

      if (dryRun) {
        items.push({
          mapResult,
          status: 'dry_run_update',
          changeSummary: llmResult.data.changeSummary,
          linesSynced,
        });
        continue;
      }

      await updateExistingDoc(docPath, llmResult.data.updatedMarkdown, options.config, {
        cwd,
        backup,
        dryRun: false,
      });

      items.push({
        mapResult,
        status: 'updated',
        outputPath: docPath,
        changeSummary: llmResult.data.changeSummary,
        linesSynced,
      });

      continue;
    }

    if (mapResult.action === 'draft') {
      const llmResult = await executeDocDraft({
        config: options.config,
        sourceFilePath: mapResult.file.path,
        codeDiff,
        generateObjectFn: options.generateObjectFn,
        model: options.model,
      });

      if (!llmResult.success) {
        items.push({
          mapResult,
          status: 'failed',
          message: llmResult.reason,
        });
        continue;
      }

      const outputPath = await createDraftDoc(
        llmResult.data.suggestedTitle,
        llmResult.data.draftMarkdown,
        options.config,
        { cwd, dryRun, now: new Date() },
      );

      if (dryRun) {
        items.push({
          mapResult,
          status: 'dry_run_draft',
          outputPath,
        });
        continue;
      }

      items.push({
        mapResult,
        status: 'draft_created',
        outputPath,
        changeSummary: llmResult.data.rationale,
      });
    }
  }

  const result: PipelineRunResult = { items, dryRun };

  if (!options.silent) {
    printPipelineSummary(items);
  }

  return result;
}
