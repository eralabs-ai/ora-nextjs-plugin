import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { pathSegments, walkFiles } from './walk-files.js';

/**
 * Locates the project's App Router root: `app/` or `src/app/` (Next.js supports both; it forbids
 * having both at once, so root `app/` is checked first and either match is unambiguous). Returns
 * undefined if neither exists — a normal case for a project this plugin has nothing to scan
 * (e.g. a Pages Router app, or a fixture with no routes at all).
 */
export function findAppDir(cwd: string): string | undefined {
  for (const candidate of [join(cwd, 'app'), join(cwd, 'src', 'app')]) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  return undefined;
}

/** File names the App Router recognizes as a page, across the extensions that can render one. */
const PAGE_FILE_RE = /^page\.(?:tsx|jsx|js)$/;

/**
 * The URL path an App Router page file is served at, or undefined when it isn't a statically
 * addressable page — not under the app dir, not a `page.*` file, inside a private (`_`) folder, or
 * on a dynamic/parallel/intercepting segment whose real URL is ambiguous from static inspection
 * alone (never guessed — precision over recall).
 */
export function resolvePagePathname(
  absolutePath: string,
  appDir: string | undefined,
): string | undefined {
  if (!appDir || !absolutePath.startsWith(appDir)) return undefined;
  const rel = relative(appDir, absolutePath);
  const base = rel.split(/[/\\]/).pop() ?? '';
  if (!PAGE_FILE_RE.test(base)) return undefined;
  const segments = pathSegments(join(rel, '..'));

  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment.startsWith('(') && segment.endsWith(')')) continue; // route group — no URL segment
    if (/^[[@_(]/.test(segment)) return undefined; // dynamic/parallel/private/intercepting
    resolved.push(segment);
  }
  return `/${resolved.join('/')}`;
}

/**
 * Every statically addressable page route under the app dir, sorted, deduplicated. This is the
 * route manifest only a build-time tool can produce — middleware and error pages can't know the
 * route table at runtime, but the source tree does. Dynamic/parallel/intercepted routes are
 * deliberately absent (their concrete URLs aren't statically knowable).
 */
export function listStaticPageRoutes(appDir: string): string[] {
  const routes = new Set<string>();
  for (const file of walkFiles(appDir, (name) => PAGE_FILE_RE.test(name))) {
    const pathname = resolvePagePathname(file.absolutePath, appDir);
    if (pathname !== undefined) routes.add(pathname);
  }
  return [...routes].sort();
}
