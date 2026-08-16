import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';

import { Buffer } from 'node:buffer';

// Sizes for the artifacts a build generates, reported in the two units that matter to a consuming
// agent: bytes on the wire and *tokens* in its context window. Tokens are the real constraint — an
// artifact that fits on disk can still blow an agent's budget — and they cost nothing to estimate at
// write time.

/**
 * Characters per token. Four is the rule-of-thumb Ora uses for English-ish text; it is an estimate,
 * not a tokenizer, and that is the point — a free approximation of the number that actually
 * constrains the reader.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Claude Code truncates a fetched response above this many characters, silently dropping everything
 * past it. An artifact an agent is meant to read whole must stay under it.
 */
export const TRUNCATION_CHAR_LIMIT = 100_000;

export interface ArtifactSize {
  /** Human label for the artifact (e.g. `ai-catalog.json`). */
  artifact: string;
  /** Where it was written, relative to the project root. */
  path: string;
  /** Bytes on disk (UTF-8). */
  bytes: number;
  /** Character count — the basis for the token estimate, and what the truncation limit measures. */
  chars: number;
  /** Estimated tokens (`chars / 4`, rounded). */
  tokens: number;
}

/** Estimated token count for a character count. */
export function estimateTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

/** Whether a character count exceeds the truncation limit an agent would hit reading the artifact. */
export function exceedsTruncationLimit(chars: number): boolean {
  return chars > TRUNCATION_CHAR_LIMIT;
}

/** A compact `KB` string; sub-kilobyte artifacts read in bytes so tiny files aren't all "0 KB". */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** A compact token string: `~840 tokens` under a thousand, `~3k tokens` above. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `~${tokens} tokens`;
  return `~${Math.round(tokens / 1000)}k tokens`;
}

/** `2 KB (~500 tokens)` — the size half of a summary line. */
export function formatArtifactSize(size: ArtifactSize): string {
  return `${humanSize(size.bytes)} (${formatTokens(size.tokens)})`;
}

/**
 * Measures the *served content* of an artifact — the bytes an agent actually receives — from a
 * string already in hand, so the numbers reflect the HTTP response rather than whatever wrapper the
 * content is written into on disk. Use this whenever the served form differs from the file: a route
 * handler embeds its JSON/markdown payload in JS boilerplate, and the catalog's served body is the
 * same JSON whether emitted as a static file or via a route. `path` is the file it was written to,
 * for display.
 */
export function measureContent(content: string, artifact: string, path: string): ArtifactSize {
  return {
    artifact,
    path,
    bytes: Buffer.byteLength(content, 'utf8'),
    chars: content.length,
    tokens: estimateTokens(content.length),
  };
}

/**
 * Measures a written artifact from disk (for content served verbatim as its file — robots.txt, a
 * static llms.txt), or returns undefined when the path doesn't exist or can't be read: reporting a
 * size must never be the reason a build fails. `chars` is the UTF-8 decoded length (what a token
 * estimate and the truncation limit are about); `bytes` is the on-disk size. When the served form
 * differs from the file (a route handler), measure the payload with `measureContent` instead.
 */
export function measureArtifact(
  cwd: string,
  absolutePath: string,
  artifact: string,
): ArtifactSize | undefined {
  try {
    const bytes = statSync(absolutePath).size;
    const chars = readFileSync(absolutePath, 'utf8').length;
    return {
      artifact,
      path: relative(cwd, absolutePath),
      bytes,
      chars,
      tokens: estimateTokens(chars),
    };
  } catch {
    return undefined;
  }
}
