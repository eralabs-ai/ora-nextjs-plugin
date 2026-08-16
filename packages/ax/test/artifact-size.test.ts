import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  estimateTokens,
  exceedsTruncationLimit,
  formatArtifactSize,
  formatTokens,
  humanSize,
  measureArtifact,
  measureContent,
  TRUNCATION_CHAR_LIMIT,
} from '../src/artifact-size.js';

describe('token / size formatting', () => {
  it('estimates tokens as chars ÷ 4, rounded', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(10)).toBe(3);
    expect(estimateTokens(100_000)).toBe(25_000);
  });

  it('formats bytes below a kilobyte in B and above in KB', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2 KB');
  });

  it('formats tokens compactly, switching to k above a thousand', () => {
    expect(formatTokens(840)).toBe('~840 tokens');
    expect(formatTokens(3200)).toBe('~3k tokens');
  });

  it('flags only character counts above the truncation limit', () => {
    expect(exceedsTruncationLimit(TRUNCATION_CHAR_LIMIT)).toBe(false);
    expect(exceedsTruncationLimit(TRUNCATION_CHAR_LIMIT + 1)).toBe(true);
  });
});

describe('measureContent', () => {
  it('measures a served string in chars, UTF-8 bytes, and tokens with the given path', () => {
    const size = measureContent('hello', 'x', 'public/x.txt');
    expect(size).toEqual({ artifact: 'x', path: 'public/x.txt', bytes: 5, chars: 5, tokens: 1 });
  });

  it('counts multibyte content as chars for tokens but bytes for size', () => {
    const size = measureContent('é', 'm', 'm.txt');
    expect(size.chars).toBe(1);
    expect(size.bytes).toBe(2);
  });

  it('measures the served payload, which is smaller than the same body wrapped in a route handler', () => {
    const body = '# Title\n[link](/a)\n';
    const wrapped = `export const dynamic = 'force-static';\nconst body = ${JSON.stringify(body)};\n`;
    expect(measureContent(body, 'llms.txt', 'app/llms.txt/route.ts').chars).toBeLessThan(
      wrapped.length,
    );
  });
});

describe('measureArtifact', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ax-artifact-size-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('measures a written file in bytes, chars, and tokens with a project-relative path', () => {
    writeFileSync(join(dir, 'a.txt'), 'hello', 'utf8');

    const size = measureArtifact(dir, join(dir, 'a.txt'), 'a.txt');

    expect(size).toEqual({ artifact: 'a.txt', path: 'a.txt', bytes: 5, chars: 5, tokens: 1 });
    expect(formatArtifactSize(size!)).toBe('5 B (~1 tokens)');
  });

  it('counts UTF-8 bytes and characters separately for multibyte content', () => {
    // "é" is one character but two UTF-8 bytes — the token estimate is about characters.
    writeFileSync(join(dir, 'm.txt'), 'é', 'utf8');

    const size = measureArtifact(dir, join(dir, 'm.txt'), 'm.txt');

    expect(size?.chars).toBe(1);
    expect(size?.bytes).toBe(2);
  });

  it('returns undefined rather than throwing for a missing file', () => {
    expect(measureArtifact(dir, join(dir, 'nope.txt'), 'nope')).toBeUndefined();
  });

  it('marks an over-limit artifact as exceeding truncation', () => {
    writeFileSync(join(dir, 'big.md'), 'x'.repeat(TRUNCATION_CHAR_LIMIT + 1), 'utf8');

    const size = measureArtifact(dir, join(dir, 'big.md'), 'big.md');

    expect(size).toBeDefined();
    expect(exceedsTruncationLimit(size!.chars)).toBe(true);
  });
});
