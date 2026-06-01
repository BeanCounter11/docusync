import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import type { DocuSyncConfig } from '../config/schema.js';
import type { PipelineItemResult } from '../pipeline/types.js';

export interface DraftCommentInput {
  draftPath: string;
  sourceFilePath: string;
  previewMarkdown: string;
}

const PREVIEW_MAX_CHARS = 6000;

function truncatePreview(markdown: string): string {
  if (markdown.length <= PREVIEW_MAX_CHARS) {
    return markdown;
  }

  return `${markdown.slice(0, PREVIEW_MAX_CHARS)}\n\n_(preview truncated)_`;
}

export function buildDraftPullRequestComment(
  drafts: DraftCommentInput[],
): string {
  const draftSections = drafts
    .map((draft) => {
      const relativePath = draft.draftPath.replace(/\\/g, '/');
      return [
        `<details>`,
        `<summary><strong>${relativePath}</strong> (from <code>${draft.sourceFilePath}</code>)</summary>`,
        '',
        truncatePreview(draft.previewMarkdown),
        '',
        `</details>`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    '🔍 **DocuSync Notice:** We detected a new feature and drafted a corresponding guide layout for you!',
    '',
    'Here is a markdown preview of the generated draft(s). Review and move them from `docs/drafts/` into your permanent documentation when ready.',
    '',
    draftSections,
  ].join('\n');
}

export async function loadDraftPreview(
  draftPath: string,
  cwd: string,
): Promise<string> {
  const absolutePath = path.isAbsolute(draftPath)
    ? draftPath
    : path.resolve(cwd, draftPath);

  return readFile(absolutePath, 'utf-8');
}

export interface PostDraftCommentsOptions {
  config: DocuSyncConfig;
  cwd?: string;
  items: PipelineItemResult[];
  pullRequestNumber: number;
  repository: { owner: string; repo: string };
  token?: string;
}

export async function postDraftPullRequestComments(
  options: PostDraftCommentsOptions,
): Promise<void> {
  if (!options.config.github.commentOnDraft) {
    return;
  }

  const draftItems = options.items.filter(
    (item) => item.status === 'draft_created' && item.outputPath,
  );

  if (draftItems.length === 0) {
    return;
  }

  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    core.warning('GITHUB_TOKEN is not set; skipping DocuSync PR comment.');
    return;
  }

  const cwd = options.cwd ?? process.cwd();
  const drafts: DraftCommentInput[] = [];

  for (const item of draftItems) {
    const draftPath = item.outputPath!;

    drafts.push({
      draftPath,
      sourceFilePath: item.mapResult.file.path,
      previewMarkdown: await loadDraftPreview(draftPath, cwd),
    });
  }

  const octokit = github.getOctokit(token);
  const body = buildDraftPullRequestComment(drafts);

  await octokit.rest.issues.createComment({
    owner: options.repository.owner,
    repo: options.repository.repo,
    issue_number: options.pullRequestNumber,
    body,
  });

  core.info(`Posted DocuSync draft preview comment on PR #${options.pullRequestNumber}.`);
}
