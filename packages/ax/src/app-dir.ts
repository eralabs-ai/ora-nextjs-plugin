import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { pathSegments, ROUTE_FILE_NAMES, walkFiles } from './walk-files.js';

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

/** Extensions the App Router always recognizes as a page. */
const BASE_PAGE_EXTENSIONS = ['tsx', 'jsx', 'js'] as const;

/**
 * Extra page extensions the caller *knows* Next.js serves — whether `page.mdx` / `page.md` routes
 * at all depends on `next.config` `pageExtensions`, so the router model threads the configured
 * ones here and the default stays conservative (never over-claim a route Next may not serve).
 */
export type ExtraPageExtensions = readonly string[];

/** File names the App Router recognizes as a page, across the extensions that can render one. */
function pageFileRe(extraExtensions: ExtraPageExtensions): RegExp {
  return new RegExp(`^page\\.(?:${[...BASE_PAGE_EXTENSIONS, ...extraExtensions].join('|')})$`);
}

/**
 * The URL path an App Router page file is served at, or undefined when it isn't a statically
 * addressable page — not under the app dir, not a `page.*` file, inside a private (`_`) folder, or
 * on a dynamic/parallel/intercepting segment whose real URL is ambiguous from static inspection
 * alone (never guessed — precision over recall).
 */
export function resolvePagePathname(
  absolutePath: string,
  appDir: string | undefined,
  extraExtensions: ExtraPageExtensions = [],
): string | undefined {
  if (!appDir || !absolutePath.startsWith(appDir)) return undefined;
  const rel = relative(appDir, absolutePath);
  const base = rel.split(/[/\\]/).pop() ?? '';
  if (!pageFileRe(extraExtensions).test(base)) return undefined;
  return resolveStaticSegments(rel);
}

/**
 * The URL a page file's directory serves at, from its path relative to the app dir. Route groups
 * contribute no segment; a dynamic/parallel/private/intercepting segment makes the URL statically
 * unknowable, so this returns undefined rather than guess.
 */
function resolveStaticSegments(relPageFile: string): string | undefined {
  const segments = pathSegments(join(relPageFile, '..'));
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment.startsWith('(') && segment.endsWith(')')) continue; // route group — no URL segment
    if (/^[[@_(]/.test(segment)) return undefined; // dynamic/parallel/private/intercepting
    resolved.push(segment);
  }
  return `/${resolved.join('/')}`;
}

/** An App Router MDX/markdown page (`page.mdx` / `page.md`) paired with the route it serves. */
export interface MdxPageFile {
  /** Absolute path of the page source. */
  file: string;
  route: string;
}

/**
 * Every `page.mdx` / `page.md` under the app dir whose route is statically addressable, sorted by
 * route. Deliberately separate from {@link listStaticPageRoutes}: markdown-twin derivation wants
 * the *files* (their markdown is the twin source) regardless of what the route list reports, and
 * it applies its own `pageExtensions` filter before trusting that a file routes.
 */
export function listMdxPageFiles(appDir: string): MdxPageFile[] {
  const pages: MdxPageFile[] = [];
  for (const file of walkFiles(appDir, (name) => /^page\.mdx?$/.test(name))) {
    const rel = relative(appDir, file.absolutePath);
    const route = resolveStaticSegments(rel);
    if (route !== undefined) pages.push({ file: file.absolutePath, route });
  }
  return pages.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Every statically addressable page route under the app dir, sorted, deduplicated. This is the
 * route manifest only a build-time tool can produce — middleware and error pages can't know the
 * route table at runtime, but the source tree does. Dynamic/parallel/intercepted routes are
 * deliberately absent (their concrete URLs aren't statically knowable).
 */
export function listStaticPageRoutes(
  appDir: string,
  extraExtensions: ExtraPageExtensions = [],
): string[] {
  const matcher = pageFileRe(extraExtensions);
  const routes = new Set<string>();
  for (const file of walkFiles(appDir, (name) => matcher.test(name))) {
    const pathname = resolvePagePathname(file.absolutePath, appDir, extraExtensions);
    if (pathname !== undefined) routes.add(pathname);
  }
  return [...routes].sort();
}

/**
 * The static URL prefix of every dynamic page route, sorted and deduplicated:
 * `app/blog/[slug]/page.tsx` → `/blog`, `app/[locale]/page.tsx` → `/`. The static route list
 * refuses to guess a dynamic URL; this is the complementary honesty for consumers that answer
 * *misses* (the negotiation middleware's wayfinding): under one of these prefixes a URL may well
 * be a real page, so "not found" must never be claimed there. Parallel/intercepting/private
 * segments still contribute nothing — they aren't URL-addressable at a knowable prefix.
 */
export function listDynamicRoutePrefixes(
  appDir: string,
  extraExtensions: ExtraPageExtensions = [],
): string[] {
  const matcher = pageFileRe(extraExtensions);
  const prefixes = new Set<string>();
  for (const file of walkFiles(appDir, (name) => matcher.test(name))) {
    const rel = relative(appDir, file.absolutePath);
    const prefix = dynamicRoutePrefix(pathSegments(join(rel, '..')));
    if (prefix !== undefined) prefixes.add(prefix);
  }
  return [...prefixes].sort();
}

/** The URL segments before the first dynamic one, or undefined when the route has none. */
function dynamicRoutePrefix(segments: string[]): string | undefined {
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment.startsWith('(') && segment.endsWith(')')) continue; // route group — no URL segment
    if (segment.startsWith('[')) return `/${resolved.join('/')}` || '/';
    if (/^[@_(]/.test(segment)) return undefined; // parallel/private/intercepting
    resolved.push(segment);
  }
  return undefined;
}

/** An App Router route handler (`route.*`) file paired with the URL it mounts at. */
export interface AppApiEndpoint {
  file: string;
  url: string | undefined;
}

/**
 * The URL an App Router route handler's directory mounts at. Route groups (`(name)`) contribute no
 * segment; a `[transport]` segment — the name mcp-handler's docs and CLI scaffold use — resolves to
 * `mcp`, its documented default `streamableHttpEndpoint`. Any other dynamic (`[id]`) or parallel
 * (`@slot`) segment makes the URL ambiguous from static inspection, so this returns undefined rather
 * than guess. `relativeDir` is the handler's directory relative to the app dir.
 */
export function resolveRouteHandlerMount(relativeDir: string): string | undefined {
  const resolved: string[] = [];
  for (const segment of pathSegments(relativeDir)) {
    if (segment.startsWith('(') && segment.endsWith(')')) continue;
    if (segment === '[transport]') {
      resolved.push('mcp');
      continue;
    }
    if (/[[\]@]/.test(segment)) return undefined;
    resolved.push(segment);
  }
  return `/${resolved.join('/')}`;
}

/**
 * Every App Router `route.*` handler paired with the URL it mounts at (undefined when ambiguous).
 * The source for MCP-mount detection; the Pages Router mirror is `listPagesApiEndpoints`.
 */
export function listAppApiEndpoints(appDir: string): AppApiEndpoint[] {
  return walkFiles(appDir, (name) => ROUTE_FILE_NAMES.has(name)).map((file) => ({
    file: file.absolutePath,
    url: resolveRouteHandlerMount(file.relativeDir),
  }));
}
