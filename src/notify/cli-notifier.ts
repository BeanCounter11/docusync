import pc from 'picocolors';
import type { PipelineItemResult } from '../pipeline/types.js';

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatLinesSynced(item: PipelineItemResult): string {
  if (item.linesSynced === undefined) {
    return '';
  }

  return ` | Lines Sync'd: ${item.linesSynced}`;
}

export function printPipelineSummary(results: PipelineItemResult[]): void {
  console.log('');
  console.log(pc.bold('DocuSync Pipeline Summary'));
  console.log(pc.dim('─'.repeat(60)));

  if (results.length === 0) {
    console.log(pc.dim('No changed code files were processed.'));
    return;
  }

  for (const item of results) {
    const source = item.mapResult.file.path;

    switch (item.status) {
      case 'updated':
        console.log(
          pc.green('🟢 UPDATED:') +
            ` ${item.outputPath ?? item.mapResult.matchedDocPath}` +
            pc.dim(
              ` (Confidence: ${formatConfidence(item.mapResult.confidence)}${formatLinesSynced(item)})`,
            ),
        );
        break;

      case 'draft_created':
        console.log(
          pc.yellow('🟡 DRAFT CREATED:') +
            ` ${item.outputPath}` +
            pc.dim(` (Reason: ${item.mapResult.reason})`),
        );
        break;

      case 'dry_run_update':
        console.log(
          pc.yellow('🟡 [DRY RUN] Would Write:') +
            ` ${item.mapResult.matchedDocPath}` +
            pc.dim(
              ` (Confidence: ${formatConfidence(item.mapResult.confidence)}${formatLinesSynced(item)})`,
            ),
        );
        break;

      case 'dry_run_draft':
        console.log(
          pc.yellow('🟡 [DRY RUN] Would Write:') +
            ` ${item.outputPath}` +
            pc.dim(` (Reason: ${item.mapResult.reason})`),
        );
        break;

      case 'skipped':
        console.log(
          pc.dim('⚪ SKIPPED:') +
            ` ${source}` +
            pc.dim(` (Reason: ${item.mapResult.reason})`),
        );
        break;

      case 'failed':
        console.log(
          pc.red('🔴 FAILED:') +
            ` ${source}` +
            pc.dim(` (${item.message ?? 'Unknown error'})`),
        );
        break;

      default:
        break;
    }
  }

  console.log(pc.dim('─'.repeat(60)));
}
