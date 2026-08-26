import { describe, expect, it } from 'vitest';

import { findDocsCandidates } from '../src/docs-candidates.js';
import type { RouterModel } from '../src/router-model.js';

/** A RouterModel stub that only answers listPageRoutes — the one method the heuristic reads. */
function routerWith(pageRoutes: string[]): RouterModel {
  return {
    cwd: '/tmp',
    routers: ['app'],
    listPageRoutes: () => pageRoutes,
    listDynamicRoutePrefixes: () => [],
    resolveUrlForFile: () => undefined,
    listApiEndpoints: () => [],
  };
}

describe('findDocsCandidates', () => {
  it('groups routes by first segment and counts pages under each docs root', () => {
    const candidates = findDocsCandidates(
      routerWith(['/docs', '/docs/setup', '/docs/setup/env', '/guides/first']),
    );
    expect(candidates).toEqual([
      { root: '/docs', pageCount: 3 },
      { root: '/guides', pageCount: 1 },
    ]);
  });

  it('matches the docs-like segment names case-insensitively', () => {
    const candidates = findDocsCandidates(
      routerWith(['/Docs/intro', '/HELP', '/API-Reference/v1', '/Reference', '/Documentation/x']),
    );
    expect(candidates.map((c) => c.root)).toEqual([
      '/API-Reference',
      '/Docs',
      '/Documentation',
      '/HELP',
      '/Reference',
    ]);
  });

  it('excludes routes whose first segment is not a docs section', () => {
    const candidates = findDocsCandidates(
      routerWith(['/', '/blog', '/pricing', '/about/team', '/documents']),
    );
    expect(candidates).toEqual([]);
  });

  it('sorts the roots and returns each root once', () => {
    const candidates = findDocsCandidates(
      routerWith(['/reference/b', '/help/a', '/docs/z', '/docs/a', '/reference/a']),
    );
    expect(candidates).toEqual([
      { root: '/docs', pageCount: 2 },
      { root: '/help', pageCount: 1 },
      { root: '/reference', pageCount: 2 },
    ]);
  });
});
