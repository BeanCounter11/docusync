import pc from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  verbose?: boolean;
  json?: boolean;
}

let verboseEnabled = false;
let jsonEnabled = false;

const SECRET_ENV_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN',
  'DOCUSYNC_LLM_PROVIDER',
] as const;

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\b(xox[baprs]-)[A-Za-z0-9-]+/g,
  /(api[_-]?key\s*[:=]\s*)(["']?)[A-Za-z0-9._-]{8,}\2/gi,
  /(authorization\s*[:=]\s*)(["']?)[A-Za-z0-9._-]{8,}\2/gi,
];

function redactEnvAssignments(text: string): string {
  let output = text;

  for (const name of SECRET_ENV_NAMES) {
    const pattern = new RegExp(`(${name}\\s*=\\s*)([^\\s'"]+)`, 'gi');
    output = output.replace(pattern, `$1[REDACTED]`);
    const quotedPattern = new RegExp(`(${name}\\s*=\\s*["'])([^"']+)(["'])`, 'gi');
    output = output.replace(quotedPattern, `$1[REDACTED]$3`);
  }

  return output;
}

/**
 * Redacts API keys, tokens, and credential-like strings from log output.
 */
export function scrubSecrets(text: string): string {
  let output = redactEnvAssignments(text);

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]');
  }

  return output;
}

export function configureLogger(config: LoggerConfig = {}): void {
  verboseEnabled =
    config.verbose ?? (process.env.DOCUSYNC_VERBOSE === '1' || false);
  jsonEnabled = config.json ?? false;
}

export function isVerboseEnabled(): boolean {
  return verboseEnabled;
}

function formatPayload(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): string {
  const timestamp = new Date().toISOString();
  const base = {
    timestamp,
    level,
    message,
    ...(meta ? { meta } : {}),
  };

  if (jsonEnabled) {
    return scrubSecrets(JSON.stringify(base));
  }

  const prefix = pc.dim(`[${timestamp}]`) + ` ${level.toUpperCase().padEnd(5)}`;
  const body = scrubSecrets(message);
  const metaSuffix = meta
    ? ` ${pc.dim(scrubSecrets(JSON.stringify(meta)))}`
    : '';

  return `${prefix} ${body}${metaSuffix}`;
}

export function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (level === 'debug' && !verboseEnabled) {
    return;
  }

  const formatted = formatPayload(level, message, meta);
  const writer =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;

  writer(formatted);
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  log('info', message, meta);
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  log('warn', message, meta);
}

export function logError(message: string, meta?: Record<string, unknown>): void {
  log('error', message, meta);
}

export function logDebug(message: string, meta?: Record<string, unknown>): void {
  log('debug', message, meta);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ?? error.message;
    return scrubSecrets(`${error.name}: ${error.message}\n${stack}`);
  }

  return scrubSecrets(String(error));
}

export function logException(
  context: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  logError(`${context}: ${formatError(error)}`, meta);
}
