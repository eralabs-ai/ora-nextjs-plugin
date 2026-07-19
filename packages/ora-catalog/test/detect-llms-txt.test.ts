import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectLlmsTxt } from '../src/detect-llms-txt.js';

let dir: string;
let warnings: string[];
const warn = (message: string): void => {
  warnings.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-detect-llms-txt-'));
  warnings = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectLlmsTxt — detection', () => {
  it('references an existing app/llms.txt/route.ts', () => {
    const routeDir = join(dir, 'app', 'llms.txt');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, 'route.ts'), "export const dynamic = 'force-static';\n", 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    expect(result.entry).toMatchObject({
      identifier: 'urn:ora-catalog:llms-txt',
      type: 'text/markdown',
      url: 'https://example.com/llms.txt',
    });
    expect(result.scaffoldedPath).toBeUndefined();
  });

  it('references an existing static public/llms.txt', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# hello\n', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    expect(result.entry?.url).toBe('https://example.com/llms.txt');
  });

  it('prefers a route handler over a static file when both exist', () => {
    const routeDir = join(dir, 'app', 'llms.txt');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, 'route.ts'), "export const dynamic = 'force-static';\n", 'utf8');
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# static\n', 'utf8');

    // Both resolve to the same reference URL; this just documents the lookup never throws when
    // both exist.
    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });
    expect(result.entry?.url).toBe('https://example.com/llms.txt');
  });

  it('respects basePath when building the URL', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# hello\n', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '/app',
      warn,
      scaffold: true,
    });
    expect(result.entry?.url).toBe('https://example.com/app/llms.txt');
  });

  it('warns and skips emitting an entry when no siteUrl is known, even if llms.txt exists', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# hello\n', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: undefined,
      basePath: '',
      warn,
      scaffold: true,
    });
    expect(result.entry).toBeUndefined();
    expect(warnings.some((w) => w.includes('no site URL is known'))).toBe(true);
  });
});

describe('detectLlmsTxt — scaffolding', () => {
  it('scaffolds a starter app/llms.txt/route.ts when a tsconfig.json is present', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    expect(result.entry).toBeUndefined(); // this run's build never served the file it just wrote
    const expectedPath = join(dir, 'app', 'llms.txt', 'route.ts');
    expect(result.scaffoldedPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, 'utf8')).toContain('export function GET(): Response');
    expect(warnings.some((w) => w.includes('Scaffolded a starter llms.txt'))).toBe(true);
  });

  it('scaffolds a .js starter when there is no tsconfig.json', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    const expectedPath = join(dir, 'app', 'llms.txt', 'route.js');
    expect(result.scaffoldedPath).toBe(expectedPath);
    expect(readFileSync(expectedPath, 'utf8')).toContain('export function GET()');
    expect(readFileSync(expectedPath, 'utf8')).not.toContain(': Response');
  });

  it('does nothing when scaffold: false', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: false,
    });

    expect(result).toEqual({});
    expect(existsSync(join(dir, 'app', 'llms.txt'))).toBe(false);
  });

  it('does nothing when there is no app/ directory to scaffold into', () => {
    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });
    expect(result).toEqual({});
  });

  it('never overwrites an existing route file (idempotent across runs)', () => {
    const routeDir = join(dir, 'app', 'llms.txt');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, 'route.ts'), '# custom content\n', 'utf8');

    detectLlmsTxt({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn, scaffold: true });

    expect(readFileSync(join(routeDir, 'route.ts'), 'utf8')).toBe('# custom content\n');
  });

  it('warns instead of throwing when app/llms.txt exists as a plain file, not a directory', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'llms.txt'), 'not a directory', 'utf8');

    expect(() =>
      detectLlmsTxt({
        cwd: dir,
        siteUrl: 'https://example.com',
        basePath: '',
        warn,
        scaffold: true,
      }),
    ).not.toThrow();
    expect(warnings.some((w) => w.includes("couldn't"))).toBe(true);
  });
});
