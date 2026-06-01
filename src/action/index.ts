import * as core from '@actions/core';
import { loadConfig, isDryRunEnabled } from '../config/loader.js';
import { commitDocuSyncChanges } from '../git/commit.js';
import { indexDocuments } from '../index/indexer.js';
import { postDraftPullRequestComments } from '../notify/github-comment.js';
import { printPipelineSummary } from '../notify/cli-notifier.js';
import { runPipeline } from '../pipeline/run.js';
import type { PipelineItemResult } from '../pipeline/types.js';
import { scrubSecrets } from '../utils/logger.js';
import {
  logActionContext,
  resolveActionGitContext,
  resolveDiffRefs,
} from './context.js';

function collectWrittenPaths(items: PipelineItemResult[]): string[] {
  return items
    .filter(
      (item) =>
        (item.status === 'updated' || item.status === 'draft_created') &&
        item.outputPath,
    )
    .map((item) => item.outputPath!);
}

async function run(): Promise<void> {
  const configPath = core.getInput('config-path') || 'docusync.json';
  const dryRunInput = core.getInput('dry-run') === 'true';
  const baseRefInput = core.getInput('base-ref');
  const headRefInput = core.getInput('head-ref');

  const gitContext = resolveActionGitContext();
  const refs = resolveDiffRefs(gitContext, {
    baseRef: baseRefInput,
    headRef: headRefInput,
  });

  logActionContext(refs);

  const { config } = await loadConfig({ configPath });
  const cwd = process.cwd();
  const dryRun = isDryRunEnabled(dryRunInput);

  core.info('Indexing documentation corpus...');
  const indexStats = await indexDocuments({ config, cwd });
  core.info(
    `Index complete: scanned=${indexStats.filesScanned}, reindexed=${indexStats.filesReindexed}, skipped=${indexStats.filesSkipped}`,
  );

  const pipelineResult = await runPipeline({
    config,
    cwd,
    dryRun,
    diffMode: { type: 'branch', base: refs.baseSha, head: refs.headSha },
    silent: true,
  });

  printPipelineSummary(pipelineResult.items);

  if (
    refs.pullRequestNumber > 0 &&
    pipelineResult.items.some((item) => item.status === 'draft_created')
  ) {
    await postDraftPullRequestComments({
      config,
      cwd,
      items: pipelineResult.items,
      pullRequestNumber: refs.pullRequestNumber,
      repository: gitContext.repository,
    });
  }

  if (!dryRun) {
    const writtenPaths = collectWrittenPaths(pipelineResult.items);

    if (writtenPaths.length > 0) {
      const commitResult = await commitDocuSyncChanges({
        config,
        cwd,
        filePaths: writtenPaths,
        headRef: refs.headRef,
      });

      if (commitResult.committed) {
        core.info(
          `Committed documentation changes (${commitResult.commitHash}) and pushed to refs/heads/${refs.headRef}`,
        );
      } else {
        core.info('No staged documentation changes to commit.');
      }
    } else {
      core.info('Pipeline produced no file writes; skipping commit.');
    }
  } else {
    core.info('Dry-run enabled — skipping git commit and push.');
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(scrubSecrets(message));
});
