import { describe, expect, it } from 'vitest';
import { resolveDiffRefs, type ActionGitContext } from '../../../src/action/context.ts';

describe('resolveDiffRefs', () => {
  const gitContext: ActionGitContext = {
    eventName: 'pull_request',
    repository: { owner: 'acme', repo: 'docs-app' },
    refs: {
      baseSha: 'base123',
      headSha: 'head456',
      headRef: 'feature/auth',
      pullRequestNumber: 42,
    },
  };

  it('uses pull_request SHAs from the GitHub context by default', () => {
    const refs = resolveDiffRefs(gitContext, {});

    expect(refs.baseSha).toBe('base123');
    expect(refs.headSha).toBe('head456');
    expect(refs.headRef).toBe('feature/auth');
    expect(refs.pullRequestNumber).toBe(42);
  });

  it('allows explicit base-ref and head-ref input overrides', () => {
    const refs = resolveDiffRefs(gitContext, {
      baseRef: 'override-base',
      headRef: 'override-head',
    });

    expect(refs.baseSha).toBe('override-base');
    expect(refs.headSha).toBe('override-head');
  });

  it('throws when base and head SHAs cannot be resolved', () => {
    expect(() =>
      resolveDiffRefs(
        { eventName: 'workflow_dispatch', repository: { owner: 'a', repo: 'b' }, refs: null },
        {},
      ),
    ).toThrow(/base and head git SHAs/);
  });
});
