import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildRouterModel } from '../src/router-model.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-router-model-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(
  relPath: string,
  contents = 'export default function C() { return null; }\n',
): string {
  const abs = join(dir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, contents, 'utf8');
  return abs;
}

describe('buildRouterModel — router detection', () => {
  it('reports no routers for a project with neither app/ nor pages/', () => {
    const model = buildRouterModel(dir);
    expect(model.routers).toEqual([]);
    expect(model.primary).toBeUndefined();
    expect(model.listPageRoutes()).toEqual([]);
    expect(model.listApiEndpoints()).toEqual([]);
  });

  it('detects an App-Router-only project', () => {
    write('app/page.tsx');
    const model = buildRouterModel(dir);
    expect(model.routers).toEqual(['app']);
    expect(model.primary).toBe('app');
  });

  it('detects a Pages-Router-only project', () => {
    write('pages/index.tsx');
    const model = buildRouterModel(dir);
    expect(model.routers).toEqual(['pages']);
    expect(model.primary).toBe('pages');
  });

  it('detects a hybrid project and prefers the App Router as primary', () => {
    write('app/page.tsx');
    write('pages/about.tsx');
    const model = buildRouterModel(dir);
    expect(model.routers).toEqual(['app', 'pages']);
    expect(model.primary).toBe('app');
  });
});

describe('buildRouterModel — listPageRoutes', () => {
  it('unions the routes from both routers (a real hybrid defines each route in only one)', () => {
    // A buildable hybrid app never defines the same route in both routers — Next.js hard-errors on
    // that — so there is no collision to resolve; the model just lists each route once across both.
    write('app/page.tsx'); // /            (App Router)
    write('app/dashboard/page.tsx'); // /dashboard   (App Router)
    write('pages/about.tsx'); // /about       (Pages Router)

    expect(buildRouterModel(dir).listPageRoutes()).toEqual(['/', '/about', '/dashboard']);
  });
});

describe('buildRouterModel — resolveUrlForFile', () => {
  it('resolves an App Router page and a Pages Router page in a hybrid app', () => {
    const appPage = write('app/products/page.tsx');
    const pagesPage = write('pages/about.tsx');
    const model = buildRouterModel(dir);
    expect(model.resolveUrlForFile(appPage)).toBe('/products');
    expect(model.resolveUrlForFile(pagesPage)).toBe('/about');
  });

  it('returns undefined for a file that is neither a statically addressable page', () => {
    const apiFile = write('pages/api/hello.ts');
    const model = buildRouterModel(dir);
    expect(model.resolveUrlForFile(apiFile)).toBeUndefined();
  });
});

describe('buildRouterModel — listApiEndpoints', () => {
  it('collects handlers from both routers, tagged with their router', () => {
    write('app/[transport]/route.ts');
    write('pages/api/[transport].ts');

    const endpoints = buildRouterModel(dir).listApiEndpoints();
    const summary = endpoints
      .map((e) => ({ url: e.url, router: e.router }))
      .sort((a, b) => (a.url ?? '').localeCompare(b.url ?? ''));
    expect(summary).toEqual([
      { url: '/api/mcp', router: 'pages' },
      { url: '/mcp', router: 'app' },
    ]);
  });
});
