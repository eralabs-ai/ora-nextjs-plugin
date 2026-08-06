import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findPagesDir,
  listPagesApiEndpoints,
  listStaticPagesRoutes,
  resolvePagesPathname,
} from '../src/pages-dir.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-pages-dir-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a file (creating parent dirs) under the temp project and returns its absolute path. */
function write(
  relPath: string,
  contents = 'export default function P() { return null; }\n',
): string {
  const abs = join(dir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, contents, 'utf8');
  return abs;
}

describe('findPagesDir', () => {
  it('finds a root pages/ directory', () => {
    mkdirSync(join(dir, 'pages'), { recursive: true });
    expect(findPagesDir(dir)).toBe(join(dir, 'pages'));
  });

  it('finds a src/pages/ directory when root pages/ is absent', () => {
    mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
    expect(findPagesDir(dir)).toBe(join(dir, 'src', 'pages'));
  });

  it('prefers root pages/ over src/pages/ when both exist', () => {
    mkdirSync(join(dir, 'pages'), { recursive: true });
    mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
    expect(findPagesDir(dir)).toBe(join(dir, 'pages'));
  });

  it('returns undefined when neither exists (e.g. an App Router app)', () => {
    expect(findPagesDir(dir)).toBeUndefined();
  });
});

describe('resolvePagesPathname', () => {
  it('maps index.tsx to its directory URL', () => {
    const pagesDir = join(dir, 'pages');
    expect(resolvePagesPathname(write('pages/index.tsx'), pagesDir)).toBe('/');
    expect(resolvePagesPathname(write('pages/blog/index.tsx'), pagesDir)).toBe('/blog');
  });

  it('maps a file path to its route (file-is-the-route, no page.* convention)', () => {
    const pagesDir = join(dir, 'pages');
    expect(resolvePagesPathname(write('pages/about.tsx'), pagesDir)).toBe('/about');
    expect(resolvePagesPathname(write('pages/blog/first-post.tsx'), pagesDir)).toBe(
      '/blog/first-post',
    );
  });

  // Precision over recall: every one of these must NOT produce a route URL.
  it('excludes dynamic segments (their concrete URL is not statically knowable)', () => {
    const pagesDir = join(dir, 'pages');
    expect(resolvePagesPathname(write('pages/[slug].tsx'), pagesDir)).toBeUndefined();
    expect(resolvePagesPathname(write('pages/blog/[id].tsx'), pagesDir)).toBeUndefined();
    expect(resolvePagesPathname(write('pages/[...all].tsx'), pagesDir)).toBeUndefined();
  });

  it('excludes API routes, special files, error pages, and private folders', () => {
    const pagesDir = join(dir, 'pages');
    expect(resolvePagesPathname(write('pages/api/hello.ts'), pagesDir)).toBeUndefined();
    expect(resolvePagesPathname(write('pages/_app.tsx'), pagesDir)).toBeUndefined();
    expect(resolvePagesPathname(write('pages/_document.tsx'), pagesDir)).toBeUndefined();
    expect(resolvePagesPathname(write('pages/_error.tsx'), pagesDir)).toBeUndefined();
    expect(resolvePagesPathname(write('pages/404.tsx'), pagesDir)).toBeUndefined();
    expect(resolvePagesPathname(write('pages/500.tsx'), pagesDir)).toBeUndefined();
    expect(resolvePagesPathname(write('pages/_components/widget.tsx'), pagesDir)).toBeUndefined();
  });

  it('returns undefined for a file outside the pages dir or with no pages dir', () => {
    expect(resolvePagesPathname(write('pages/index.tsx'), undefined)).toBeUndefined();
    expect(resolvePagesPathname(join(dir, 'app', 'page.tsx'), join(dir, 'pages'))).toBeUndefined();
  });
});

describe('listStaticPagesRoutes', () => {
  it('lists only statically addressable content routes, sorted and deduped', () => {
    write('pages/index.tsx');
    write('pages/about.tsx');
    write('pages/blog/index.tsx');
    write('pages/blog/[slug].tsx'); // dynamic — excluded
    write('pages/api/hello.ts'); // api — excluded
    write('pages/_app.tsx'); // special — excluded
    write('pages/404.tsx'); // error page — excluded

    expect(listStaticPagesRoutes(join(dir, 'pages'))).toEqual(['/', '/about', '/blog']);
  });
});

describe('listPagesApiEndpoints', () => {
  it('lists pages/api handlers with their served URL, resolving [transport] to /api/mcp', () => {
    write('pages/api/hello.ts');
    write('pages/api/[transport].ts');
    write('pages/index.tsx'); // not an api route — excluded

    const endpoints = listPagesApiEndpoints(join(dir, 'pages'));
    const byUrl = endpoints.map((e) => e.url).sort();
    expect(byUrl).toEqual(['/api/hello', '/api/mcp']);
  });

  it('returns an ambiguous (undefined url) endpoint for other dynamic api segments', () => {
    write('pages/api/[id].ts');
    const endpoints = listPagesApiEndpoints(join(dir, 'pages'));
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.url).toBeUndefined();
  });

  it('returns nothing when there is no pages/api directory', () => {
    write('pages/index.tsx');
    expect(listPagesApiEndpoints(join(dir, 'pages'))).toEqual([]);
  });
});
