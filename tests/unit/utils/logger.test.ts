import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  configureLogger,
  scrubSecrets,
  formatError,
  logWarn,
} from '../../../src/utils/logger.js';
import {
  formatLlmFailureMessage,
  isRateLimitError,
} from '../../../src/utils/llm-errors.js';
import { stripJsonComments } from '../../../src/utils/jsonc.js';

describe('scrubSecrets', () => {
  it('redacts OpenAI-style keys', () => {
    const input = 'Error: invalid key sk-abcdefghijklmnopqrstuvwxyz123456';
    expect(scrubSecrets(input)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(scrubSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts env assignment patterns', () => {
    const input = 'Failed: OPENAI_API_KEY=sk-live-secret-value-here';
    const output = scrubSecrets(input);
    expect(output).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(output).not.toContain('sk-live-secret');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';
    expect(scrubSecrets(input)).toContain('[REDACTED]');
  });
});

describe('formatError', () => {
  it('scrubs secrets from error stacks', () => {
    const error = new Error('request failed with OPENAI_API_KEY=sk-abc123xyz');
    error.stack = 'Error: OPENAI_API_KEY=sk-abc123xyz\n    at run()';
    const formatted = formatError(error);
    expect(formatted).not.toContain('sk-abc123xyz');
  });
});

describe('isRateLimitError', () => {
  it('detects HTTP 429 status codes', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
  });

  it('detects rate limit messages', () => {
    expect(isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
  });
});

describe('formatLlmFailureMessage', () => {
  it('returns rate-limit guidance for 429 errors', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const message = formatLlmFailureMessage({ status: 429, message: 'Too Many Requests' });

    expect(message).toContain('429');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('includes the underlying message for other failures', () => {
    const message = formatLlmFailureMessage(new Error('API unavailable'));
    expect(message).toContain('API unavailable');
  });
});

describe('stripJsonComments', () => {
  it('removes line comments and parses JSON', () => {
    const jsonc = `{
      // comment
      "a": 1
    }`;
    const stripped = stripJsonComments(jsonc);
    expect(JSON.parse(stripped)).toEqual({ a: 1 });
  });
});

describe('configureLogger', () => {
  const originalEnv = process.env.DOCUSYNC_VERBOSE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DOCUSYNC_VERBOSE;
    } else {
      process.env.DOCUSYNC_VERBOSE = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('emits warn logs by default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureLogger({ verbose: false });
    logWarn('test warning');
    expect(warnSpy).toHaveBeenCalled();
  });
});
