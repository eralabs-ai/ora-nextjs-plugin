// A docs-section heuristic that deliberately lives in `ax init` and nowhere near the build. The
// build never guesses which routes are documentation: a `/docs` route could just as easily be a
// marketing page, and inventing a `tags: ['ax:docs']` entry on a guess would publish a claim ax
// can't stand behind. So the guessing happens here, once, in front of a human — the wizard shows
// the sections it suspects are docs, the person confirms, and the answer is persisted as an
// explicit config `entries` override. That way the *build* only ever emits a docs entry the
// developer actually approved, and this module must never be imported by generate.ts.

import type { RouterModel } from './router-model.js';

/** A first-path-segment group that looks like a documentation section. `root` is like `/docs`. */
export interface DocRouteCandidate {
  root: string;
  pageCount: number;
}

/**
 * First path segments whose name reads as documentation. Matched case-insensitively against the
 * first segment of each static page route; anything else is left alone (the build's whole posture
 * is to never invent a docs claim from a route).
 */
const DOCS_SEGMENTS = new Set([
  'docs',
  'guides',
  'help',
  'api-reference',
  'reference',
  'documentation',
]);

/**
 * Groups the router's static page routes by their first path segment and returns the groups whose
 * segment names a documentation section (see {@link DOCS_SEGMENTS}), sorted by root. The count is
 * how many pages sit under that root, purely so the wizard can say "3 pages under /docs" — it does
 * not affect whether the section is offered.
 */
export function findDocsCandidates(router: RouterModel): DocRouteCandidate[] {
  const counts = new Map<string, number>();
  for (const route of router.listPageRoutes()) {
    const segment = route.split('/').filter((part) => part !== '')[0];
    if (segment === undefined) continue;
    if (!DOCS_SEGMENTS.has(segment.toLowerCase())) continue;
    const root = `/${segment}`;
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([root, pageCount]) => ({ root, pageCount }))
    .sort((a, b) => a.root.localeCompare(b.root));
}
