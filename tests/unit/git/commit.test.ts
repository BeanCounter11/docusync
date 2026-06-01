import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../src/config/schema.ts';
import {
  commitDocuSyncChanges,
  configureGitUser,
} from '../../../src/git/commit.ts';

describe('commitDocuSyncChanges', () => {
  it('configures bot author and pushes to the PR head branch', async () => {
    const addConfig = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn().mockResolvedValue({ commit: 'abc1234' });
    const push = vi.fn().mockResolvedValue(undefined);

    const git = {
      addConfig,
      add,
      commit,
      push,
      status: vi.fn().mockResolvedValue({
        staged: ['docs/guide.md'],
        created: [],
        modified: [],
      }),
    };

    await configureGitUser(defaultConfig, '/repo', git as never);

    expect(addConfig).toHaveBeenCalledWith(
      'user.name',
      'github-actions[bot]',
      false,
      'local',
    );
    expect(addConfig).toHaveBeenCalledWith(
      'user.email',
      '41898282+github-actions[bot]@users.noreply.github.com',
      false,
      'local',
    );

    const result = await commitDocuSyncChanges({
      config: defaultConfig,
      filePaths: ['docs/guide.md'],
      headRef: 'feature/docs-sync',
      git: git as never,
    });

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(commit).toHaveBeenCalledWith(
      'docs: auto-update via DocuSync [skip ci]',
    );
    expect(push).toHaveBeenCalledWith(
      'origin',
      'HEAD:refs/heads/feature/docs-sync',
    );
  });

  it('skips commit when there are no staged documentation changes', async () => {
    const git = {
      addConfig: vi.fn(),
      add: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      status: vi.fn().mockResolvedValue({
        staged: [],
        created: [],
        modified: [],
      }),
    };

    const result = await commitDocuSyncChanges({
      config: defaultConfig,
      filePaths: ['docs/guide.md'],
      headRef: 'feature/docs-sync',
      git: git as never,
    });

    expect(result.committed).toBe(false);
    expect(git.commit).not.toHaveBeenCalled();
  });
});
