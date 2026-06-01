import { logWarn } from './logger.js';

const RATE_LIMIT_HINT = `DocuSync hit an LLM rate limit (HTTP 429).

What you can do:
  • Wait a minute and retry the command.
  • Switch to a smaller or local model in docusync.json (e.g. gpt-4o-mini or Ollama).
  • Set DOCUSYNC_LLM_PROVIDER=ollama and run a local model to avoid cloud quotas.
  • Reduce parallel work: run on smaller diffs or increase provider rate limits in your dashboard.`;

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
    cause?: unknown;
  };

  const status = candidate.status ?? candidate.statusCode;
  if (status === 429) {
    return true;
  }

  const message = String(candidate.message ?? '').toLowerCase();
  if (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return true;
  }

  if (candidate.cause) {
    return isRateLimitError(candidate.cause);
  }

  return false;
}

export function formatLlmFailureMessage(error: unknown): string {
  if (isRateLimitError(error)) {
    logWarn(RATE_LIMIT_HINT);
    return 'LLM request failed: rate limit exceeded (HTTP 429). See guidance above.';
  }

  const message = error instanceof Error ? error.message : String(error);
  return `LLM request failed: ${message}`;
}
