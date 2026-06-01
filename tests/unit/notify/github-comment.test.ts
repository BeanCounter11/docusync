import { describe, expect, it } from 'vitest';
import { buildDraftPullRequestComment } from '../../../src/notify/github-comment.ts';

describe('buildDraftPullRequestComment', () => {
  it('renders the DocuSync notice with collapsible draft previews', () => {
    const body = buildDraftPullRequestComment([
      {
        draftPath: 'docs/drafts/20260531-webhooks.md',
        sourceFilePath: 'src/webhooks/handler.ts',
        previewMarkdown: '# Webhooks\n\nHandle inbound events.',
      },
    ]);

    expect(body).toContain('DocuSync Notice');
    expect(body).toContain('<details>');
    expect(body).toContain('docs/drafts/20260531-webhooks.md');
    expect(body).toContain('src/webhooks/handler.ts');
    expect(body).toContain('# Webhooks');
  });
});
