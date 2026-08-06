import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { pathSegments, walkFiles } from './walk-files.js';

/**
 * Locates the project's Pages Router root: `pages/` or `src/pages/` (Next.js supports both; root
 * `pages/` is checked first). Returns undefined when neither exists — the App Router counterpart is
 * `findAppDir`. A project may have both an App Router and a Pages Router at once (a common migration
 * state), which is why this and `findAppDir` are asked independently, never either/or.
 */
export function findPagesDir(cwd: string): string | undefined {
  for (const candidate of [join(cwd, 'pages'), join(cwd, 'src', 'pages')]) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  return undefined;
}

/** Extensions the Pages Router treats as a routable module. */
const PAGE_EXT_RE = /\.(?:tsx|jsx|ts|js|mjs|cjs)$/;

/** Root-level pages that render error responses, not addressable content — excluded from routes. */
const ERROR_PAGE_NAMES: ReadonlySet<string> = new Set(['404', '500']);

/**
 * Splits a file path relative to the pages dir into its URL route segments: the directory segments
 * followed by the file's base name with the extension stripped, dropping a trailing `index` (which
 * maps to its directory's URL). `pages/blog/index.tsx` → `['blog']`; `pages/about.tsx` → `['about']`;
 * `pages/api/[transport].ts` → `['api', '[transport]']`.
 */
function routeSegments(relPath: string): string[] {
  const parts = pathSegments(relPath);
  const last = parts.pop() ?? '';
  const name = last.replace(PAGE_EXT_RE, '');
  if (name !== 'index') parts.push(name);
  return parts;
}

/**
 * The URL path a Pages Router page file is served at, or undefined when it isn't a statically
 * addressable page — not under the pages dir, not a routable extension, an API route (`pages/api/*`),
 * a special/error page (`_app`/`_document`/`_error`/`404`/`500`), inside a private (`_`) folder, or
 * on a dynamic (`[param]`/`[...slug]`) segment whose real URL isn't knowable from static inspection.
 * The Pages Router mirror of `resolvePagePathname` — file-path-is-the-route rather than a `page.*`
 * convention — and it applies the same precision-over-recall rule: never guess a dynamic URL.
 */
export function resolvePagesPathname(
  absolutePath: string,
  pagesDir: string | undefined,
): string | undefined {
  if (!pagesDir || !absolutePath.startsWith(pagesDir)) return undefined;
  const rel = relative(pagesDir, absolutePath);
  const base = rel.split(/[/\\]/).pop() ?? '';
  if (!PAGE_EXT_RE.test(base)) return undefined;

  const segments = routeSegments(rel);
  if (segments[0] === 'api') return undefined; // API routes aren't pages
  if (segments.length === 1 && ERROR_PAGE_NAMES.has(segments[0] ?? '')) return undefined;

  const resolved: string[] = [];
  for (const segment of segments) {
    if (/^[[_]/.test(segment)) return undefined; // dynamic segment or private (`_`) file/folder
    resolved.push(segment);
  }
  return `/${resolved.join('/')}`;
}

/**
 * Every statically addressable Pages Router route, sorted and deduplicated — the Pages Router mirror
 * of `listStaticPageRoutes`. Dynamic/private/API/error files are deliberately absent (their concrete
 * URLs aren't statically knowable, or they aren't content pages).
 */
export function listStaticPagesRoutes(pagesDir: string): string[] {
  const routes = new Set<string>();
  for (const file of walkFiles(pagesDir, (name) => PAGE_EXT_RE.test(name))) {
    const pathname = resolvePagesPathname(file.absolutePath, pagesDir);
    if (pathname !== undefined) routes.add(pathname);
  }
  return [...routes].sort();
}

/** A route handler / API endpoint file with the URL it serves at (undefined when ambiguous). */
export interface PagesApiEndpoint {
  file: string;
  url: string | undefined;
}

/**
 * The URL a `pages/api/*` handler serves at, with mcp-handler's `[transport]` convention resolved to
 * `mcp` (its documented default endpoint) — the Pages Router equivalent of an App Router `route.ts`
 * mount. Any other dynamic (`[id]`) or private (`_`) segment makes the URL ambiguous, so this returns
 * undefined rather than guess. `pages/api/mcp.ts` → `/api/mcp`; `pages/api/[transport].ts` → `/api/mcp`.
 */
function resolvePagesApiPathname(absolutePath: string, pagesDir: string): string | undefined {
  const rel = relative(pagesDir, absolutePath);
  const resolved: string[] = [];
  for (const segment of routeSegments(rel)) {
    if (segment === '[transport]') {
      resolved.push('mcp');
      continue;
    }
    if (/^[[_]/.test(segment)) return undefined;
    resolved.push(segment);
  }
  return `/${resolved.join('/')}`;
}

/**
 * Every `pages/api/**` handler file paired with the URL it serves at. The Pages Router source for
 * MCP-mount detection, mirroring the App Router's `route.ts` handlers (`listAppApiEndpoints`).
 */
export function listPagesApiEndpoints(pagesDir: string): PagesApiEndpoint[] {
  const apiDir = join(pagesDir, 'api');
  if (!existsSync(apiDir)) return [];
  return walkFiles(apiDir, (name) => PAGE_EXT_RE.test(name)).map((file) => ({
    file: file.absolutePath,
    url: resolvePagesApiPathname(file.absolutePath, pagesDir),
  }));
}
