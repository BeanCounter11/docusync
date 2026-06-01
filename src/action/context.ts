import * as core from '@actions/core';
import * as github from '@actions/github';

export interface PullRequestGitRefs {
  baseSha: string;
  headSha: string;
  headRef: string;
  pullRequestNumber: number;
}

export interface ActionGitContext {
  eventName: string;
  refs: PullRequestGitRefs | null;
  repository: { owner: string; repo: string };
}

export function resolveActionGitContext(): ActionGitContext {
  const context = github.context;
  const repository = {
    owner: context.repo.owner,
    repo: context.repo.repo,
  };

  if (context.eventName === 'pull_request') {
    const pullRequest = context.payload.pull_request;

    if (pullRequest?.base?.sha && pullRequest?.head?.sha) {
      const headRef =
        process.env.GITHUB_HEAD_REF?.trim() || pullRequest.head.ref;

      return {
        eventName: context.eventName,
        repository,
        refs: {
          baseSha: pullRequest.base.sha,
          headSha: pullRequest.head.sha,
          headRef,
          pullRequestNumber: pullRequest.number,
        },
      };
    }
  }

  return {
    eventName: context.eventName,
    repository,
    refs: null,
  };
}

export function resolveDiffRefs(
  gitContext: ActionGitContext,
  inputs: { baseRef?: string; headRef?: string },
): PullRequestGitRefs {
  const baseSha = inputs.baseRef?.trim() || gitContext.refs?.baseSha;
  const headSha = inputs.headRef?.trim() || gitContext.refs?.headSha;
  const headRef = gitContext.refs?.headRef || process.env.GITHUB_HEAD_REF?.trim();
  const pullRequestNumber = gitContext.refs?.pullRequestNumber ?? 0;

  if (!baseSha || !headSha) {
    throw new Error(
      'DocuSync requires base and head git SHAs. Run this action on pull_request events or provide base-ref and head-ref inputs.',
    );
  }

  if (!headRef) {
    throw new Error(
      'DocuSync could not resolve the head branch ref (GITHUB_HEAD_REF). Ensure actions/checkout checks out the PR head branch.',
    );
  }

  return {
    baseSha,
    headSha,
    headRef,
    pullRequestNumber,
  };
}

export function logActionContext(refs: PullRequestGitRefs): void {
  core.info(`DocuSync comparing ${refs.baseSha}...${refs.headSha}`);
  core.info(`Target branch ref: refs/heads/${refs.headRef}`);
}
