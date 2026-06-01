import { createHash } from 'node:crypto';

export interface MarkdownChunk {
  filePath: string;
  heading: string;
  content: string;
  contentHash: string;
}

export interface ChunkMarkdownOptions {
  maxChars?: number;
}

const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/;
const DEFAULT_MAX_CHARS = 2000;

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function splitOversizedSection(
  heading: string,
  body: string,
  maxChars: number,
): Array<{ heading: string; content: string }> {
  const trimmed = body.trim();
  if (trimmed.length <= maxChars) {
    return [{ heading, content: trimmed }];
  }

  const parts: Array<{ heading: string; content: string }> = [];
  const paragraphs = trimmed.split(/\n{2,}/);
  let buffer = '';
  let partIndex = 1;

  const flush = (): void => {
    if (!buffer.trim()) {
      return;
    }

    const suffix = parts.length > 0 || partIndex > 1 ? ` (part ${partIndex})` : '';
    parts.push({
      heading: `${heading}${suffix}`,
      content: buffer.trim(),
    });
    buffer = '';
    partIndex += 1;
  };

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;

    if (candidate.length > maxChars && buffer) {
      flush();
      buffer = paragraph;
    } else if (candidate.length > maxChars) {
      const chunks = paragraph.match(new RegExp(`.{1,${maxChars}}`, 'gs')) ?? [paragraph];
      for (const chunk of chunks) {
        const suffix = parts.length > 0 || partIndex > 1 ? ` (part ${partIndex})` : '';
        parts.push({ heading: `${heading}${suffix}`, content: chunk.trim() });
        partIndex += 1;
      }
      buffer = '';
    } else {
      buffer = candidate;
    }
  }

  flush();
  return parts.length > 0 ? parts : [{ heading, content: trimmed.slice(0, maxChars) }];
}

/**
 * Splits markdown content into heading-aware chunks (H1–H3).
 */
export function chunkMarkdown(
  filePath: string,
  markdown: string,
  options: ChunkMarkdownOptions = {},
): MarkdownChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ heading: string; lines: string[] }> = [];

  let currentHeading = '(root)';
  let currentLines: string[] = [];

  const pushSection = (): void => {
    if (currentLines.length === 0 && sections.length > 0) {
      return;
    }

    sections.push({
      heading: currentHeading,
      lines: [...currentLines],
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(HEADING_PATTERN);

    if (headingMatch) {
      pushSection();
      currentHeading = line.trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  pushSection();

  const chunks: MarkdownChunk[] = [];

  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (!body && section.heading === '(root)') {
      continue;
    }

    const fullContent = section.heading === '(root)' ? body : `${section.heading}\n\n${body}`;
    const splitSections = splitOversizedSection(section.heading, fullContent, maxChars);

    for (const part of splitSections) {
      if (!part.content.trim()) {
        continue;
      }

      chunks.push({
        filePath,
        heading: part.heading,
        content: part.content,
        contentHash: hashContent(part.content),
      });
    }
  }

  if (chunks.length === 0 && markdown.trim()) {
    const content = markdown.trim();
    chunks.push({
      filePath,
      heading: '(root)',
      content,
      contentHash: hashContent(content),
    });
  }

  return chunks;
}
