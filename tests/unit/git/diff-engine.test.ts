import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectLanguage,
  getChangedFiles,
  matchesIgnorePattern,
  parseNameStatus,
  parseUnifiedDiff,
  validateDiffModeOptions,
} from '../../../src/git/diff-engine.ts';

const SAMPLE_PATCH = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  return true;
   console.log('foo');
 }
`;

describe('parseUnifiedDiff', () => {
  it('extracts hunks and line counts from a unified diff', () => {
    const parsed = parseUnifiedDiff(SAMPLE_PATCH);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.path).toBe('src/foo.ts');
    expect(parsed[0]?.hunks).toHaveLength(1);
    expect(parsed[0]?.hunks[0]?.lines).toContain("+  return true;");
    expect(parsed[0]?.linesAdded).toBe(1);
    expect(parsed[0]?.linesRemoved).toBe(0);
  });

  it('returns an empty array for empty patches', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('   \n')).toEqual([]);
  });
});

describe('matchesIgnorePattern', () => {
  it('ignores markdown files via glob', () => {
    expect(matchesIgnorePattern('docs/guide.md', ['**/*.md'])).toBe(true);
    expect(matchesIgnorePattern('src/index.ts', ['**/*.md'])).toBe(false);
  });

  it('ignores nested draft documentation paths', () => {
    expect(
      matchesIgnorePattern('docs/drafts/new-feature.md', ['docs/drafts/**']),
    ).toBe(true);
    expect(matchesIgnorePattern('docs/readme.md', ['docs/drafts/**'])).toBe(
      false,
    );
  });
});

describe('parseNameStatus', () => {
  it('maps git name-status codes to change statuses', () => {
    const statuses = parseNameStatus(
      ['A\tsrc/new.ts', 'M\tsrc/existing.ts', 'D\tsrc/removed.ts'].join('\n'),
    );

    expect(statuses.get('src/new.ts')).toBe('added');
    expect(statuses.get('src/existing.ts')).toBe('modified');
    expect(statuses.get('src/removed.ts')).toBe('deleted');
  });
});

describe('detectLanguage', () => {
  it('maps known extensions to language names', () => {
    expect(detectLanguage('src/app.tsx')).toBe('typescript');
    expect(detectLanguage('lib/util.py')).toBe('python');
    expect(detectLanguage('Makefile')).toBeNull();
  });
});

describe('validateDiffModeOptions', () => {
  it('defaults to staged mode when no flags are provided', () => {
    expect(validateDiffModeOptions({})).toEqual({ type: 'staged' });
  });

  it('returns branch mode when base and head are provided', () => {
    expect(
      validateDiffModeOptions({ base: 'main', head: 'feature' }),
    ).toEqual({ type: 'branch', base: 'main', head: 'feature' });
  });

  it('rejects mixing staged and branch modes', () => {
    expect(() =>
      validateDiffModeOptions({ staged: true, base: 'main', head: 'feature' }),
    ).toThrow(/Cannot combine/);
  });

  it('requires both base and head for branch mode', () => {
    expect(() => validateDiffModeOptions({ base: 'main' })).toThrow(
      /Both --base and --head/,
    );
  });
});

describe('getChangedFiles', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), 'docusync-git-'));
    const git = simpleGit(repoDir);

    await git.init(['-b', 'main']);
    await git.addConfig('user.email', 'test@example.com', false, 'local');
    await git.addConfig('user.name', 'Test User', false, 'local');

    await mkdir(path.join(repoDir, 'src'), { recursive: true });
    await mkdir(path.join(repoDir, 'docs', 'drafts'), { recursive: true });

    await writeFile(
      path.join(repoDir, 'src', 'foo.ts'),
      "export function foo() {\n  console.log('foo');\n}\n",
    );
    await writeFile(path.join(repoDir, 'docs', 'guide.md'), '# Guide\n');
    await writeFile(
      path.join(repoDir, 'docs', 'drafts', 'draft.md'),
      '# Draft\n',
    );

    await git.add(['src/foo.ts', 'docs/guide.md', 'docs/drafts/draft.md']);
    await git.commit('initial commit');
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('returns staged code changes and applies ignore patterns', async () => {
    const git = simpleGit(repoDir);

    await writeFile(
      path.join(repoDir, 'src', 'foo.ts'),
      "export function foo() {\n  return true;\n  console.log('foo');\n}\n",
    );
    await writeFile(path.join(repoDir, 'docs', 'guide.md'), '# Updated Guide\n');
    await git.add(['src/foo.ts', 'docs/guide.md']);

    const files = await getChangedFiles({
      cwd: repoDir,
      mode: { type: 'staged' },
      ignorePatterns: ['**/*.md', 'docs/drafts/**'],
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('src/foo.ts');
    expect(files[0]?.status).toBe('modified');
    expect(files[0]?.language).toBe('typescript');
    expect(files[0]?.hunks.length).toBeGreaterThan(0);
    expect(files[0]?.linesAdded).toBeGreaterThan(0);
  });

  it('excludes staged draft markdown even when not covered by **/*.md alone', async () => {
    const git = simpleGit(repoDir);

    await writeFile(
      path.join(repoDir, 'docs', 'drafts', 'draft.md'),
      '# Updated Draft\n',
    );
    await git.add(['docs/drafts/draft.md']);

    const files = await getChangedFiles({
      cwd: repoDir,
      mode: { type: 'staged' },
      ignorePatterns: ['docs/drafts/**'],
    });

    expect(files).toHaveLength(0);
  });

  it('compares base and head refs in branch mode', async () => {
    const git = simpleGit(repoDir);

    await git.checkoutLocalBranch('feature');
    await mkdir(path.join(repoDir, 'src'), { recursive: true });
    await writeFile(
      path.join(repoDir, 'src', 'bar.ts'),
      "export function bar() {\n  return 42;\n}\n",
    );
    await git.add(['src/bar.ts']);
    await git.commit('add bar');

    const files = await getChangedFiles({
      cwd: repoDir,
      mode: { type: 'branch', base: 'main', head: 'feature' },
      ignorePatterns: ['**/*.md', 'docs/drafts/**'],
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('src/bar.ts');
    expect(files[0]?.status).toBe('added');
    expect(files[0]?.language).toBe('typescript');
    expect(files[0]?.hunks.length).toBeGreaterThan(0);
  });
});
