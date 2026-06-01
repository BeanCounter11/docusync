import { simpleGit, type SimpleGit } from 'simple-git';
import type { DocuSyncConfig } from '../config/schema.js';

export interface CommitDocuSyncChangesOptions {
  config: DocuSyncConfig;
  cwd?: string;
  filePaths: string[];
  headRef: string;
  git?: SimpleGit;
}

export interface CommitDocuSyncChangesResult {
  committed: boolean;
  commitHash?: string;
  pushed: boolean;
}

export async function configureGitUser(
  config: DocuSyncConfig,
  cwd?: string,
  git: SimpleGit = simpleGit(cwd),
): Promise<void> {
  await git.addConfig('user.name', config.git.authorName, false, 'local');
  await git.addConfig('user.email', config.git.authorEmail, false, 'local');
}

/**
 * Stages documentation changes, commits with the configured [skip ci] message,
 * and pushes to the pull request head branch.
 */
export async function commitDocuSyncChanges(
  options: CommitDocuSyncChangesOptions,
): Promise<CommitDocuSyncChangesResult> {
  const git = options.git ?? simpleGit(options.cwd);
  const normalizedPaths = [...new Set(options.filePaths)].filter(Boolean);

  if (normalizedPaths.length === 0) {
    return { committed: false, pushed: false };
  }

  await configureGitUser(options.config, options.cwd, git);
  await git.add(normalizedPaths);

  const status = await git.status();
  const hasStagedChanges =
    status.staged.length > 0 ||
    status.created.length > 0 ||
    status.modified.length > 0;

  if (!hasStagedChanges) {
    return { committed: false, pushed: false };
  }

  const commitResult = await git.commit(options.config.git.commitMessage);

  if (!commitResult.commit) {
    return { committed: false, pushed: false };
  }

  await git.push('origin', `HEAD:refs/heads/${options.headRef}`);

  return {
    committed: true,
    commitHash: commitResult.commit,
    pushed: true,
  };
}
