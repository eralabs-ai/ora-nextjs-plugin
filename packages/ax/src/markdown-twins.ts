import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { listMdxPageFiles, resolvePagePathname } from './app-dir.js';
import { type IsGated } from './gating.js';
import { deriveHtmlTwin, type HtmlTwinSkipReason } from './html-twin.js';
import { isGeneratedMarkdown, renderFrontmatter } from './markdown-artifact.js';
import { deriveMdxTwin } from './mdx-twin.js';
import { resolvePagesPathname } from './pages-dir.js';
import type { RouterModel } from './router-model.js';
import { absoluteOrServedUrl, servedPath } from './site-url.js';
import { pathSegments, ROUTE_FILE_NAMES, walkFiles } from './walk-files.js';

// Markdown twins: per-page markdown representations of real content, written as static files in
// `public/` (route `/docs` → `public/docs.md`, the root → `public/index.md`) so the `.md`-URL
// retrieval mechanism works with zero runtime — Next serves `public/` as-is, and the middleware
// (which negotiates the other two mechanisms) becomes an upgrade, not a requirement.
//
// Twins are *generated artifacts, never scaffolds*: regenerated every build, marked generated-by,
// never user-edited. A `.md` in `public/` WITHOUT the marker is user-authored — it already is the
// markdown source for its route, so ax records it and never touches it. The moment a human wants
// to edit a twin, the content belongs in a real markdown source, not a fork of generated output.
//
// Content comes from a ladder of decreasing certainty:
//   Tier 1 — markdown-shaped sources in the repo (`app/**/page.mdx`, an existing `public/*.md`, a
//            markdown route handler): the markdown is the source, not a reconstruction.
//   Tier 2 — the prerendered HTML in the build output, converted (see html-twin.ts's guards).
//   Tier 3 — dynamic/SSR routes: refused. No build-time HTML exists, so no twin, no guessing.
// Every refusal is recorded with its reason — the skip list is itself the "what to do next"
// guidance an agent reads from the report.

/** Which rung of the ladder produced a twin. */
export type TwinTier = 1 | 2;

export type TwinSkipReason =
  'gated' | 'not-prerendered' | 'mostly-jsx' | 'empty-mdx' | HtmlTwinSkipReason;

/** Human-actionable sentence per skip reason, carried into the report next to the reason code. */
const SKIP_DETAIL: Record<TwinSkipReason, string> = {
  gated:
    'The route is gated (isGated), and a gated page’s prerender is typically a login shell — ' +
    'deriving a twin from it would publish a converted login page as the page’s content.',
  'not-prerendered':
    'No prerendered HTML exists in the build output — the route is dynamic/SSR (or the build has ' +
    'not run). Add a markdown source for it, or prerender it, to get a twin.',
  'mostly-jsx':
    'The MDX source is mostly imports/JSX — stripping them would silently omit what the page ' +
    'shows. Move the prose into markdown (or accept the HTML-derived twin by prerendering).',
  'empty-mdx': 'The MDX source contains no markdown prose to derive a twin from.',
  'no-content-region':
    'The prerendered HTML has no <main> or <article> landmark — extracting <body> would drag ' +
    'nav/footer chrome into the twin. Wrap the page content in <main> to get a twin.',
  'too-little-text':
    'The prerendered HTML carries under 200 characters of text — a JS-shell page, whose twin ' +
    'would be an empty page presented as content.',
  'too-large': 'The converted markdown exceeds the 100,000-character fetch-truncation ceiling.',
  'uneven-fences': 'Conversion produced an unclosed code fence, which would corrupt the twin.',
};

export interface PlannedTwin {
  /** The route the twin shadows, e.g. `/docs/getting-started`. */
  route: string;
  /** The twin's served URL path (basePath-prefixed), e.g. `/docs/getting-started.md`. */
  servedPath: string;
  /** Absolute path the twin file will be written to, under `public/`. */
  filePath: string;
  tier: TwinTier;
  /** What the content was derived from. */
  source: 'mdx' | 'prerender';
  /** The full file contents (frontmatter + body). */
  content: string;
}

/** A user-authored markdown representation ax found and will never touch. */
export interface UserOwnedTwin {
  route: string;
  servedPath: string;
  /** The source that already serves the markdown, relative to the project root. */
  sourcePath: string;
}

export interface TwinSkip {
  route: string;
  reason: TwinSkipReason;
  detail: string;
}

export interface MarkdownTwinPlan {
  /** `ax.config` `markdownTwins`, resolved. A disabled plan is empty but shape-stable. */
  enabled: boolean;
  writes: PlannedTwin[];
  skips: TwinSkip[];
  userOwned: UserOwnedTwin[];
  /** Previously generated twins this run no longer produces — deleted at apply time (stale twins lie). */
  stalePaths: string[];
  /**
   * Whether any generated twin already exists on disk. False on the first run that would write
   * twins — the run the review gate must confirm even when the catalog itself isn't new.
   */
  hasExistingGenerated: boolean;
  /** Served URL paths of every twin (planned + user-owned) — feeds llms.txt, the alternate-link recommendation, and the manifest. */
  servedPaths: string[];
  /** Count of page files whose URL is dynamic — Tier 3's "no markdown target" tally. */
  dynamicRouteCount: number;
}

export interface PlanMarkdownTwinsOptions {
  cwd: string;
  router: RouterModel;
  /** The resolved gating predicate (`resolveGating(config.isGated)`). */
  isGated: IsGated;
  basePath: string;
  /** `next.config` `distDir`, when set (defaults to `.next`). */
  distDir?: string;
  /** `next.config` `pageExtensions`, when declared — gates whether `page.mdx` actually routes. */
  pageExtensions?: string[];
  siteUrl: string | undefined;
  /** `ax.config` `markdownTwins`, resolved. */
  enabled: boolean;
  warn: (message: string) => void;
  recommend: (message: string) => void;
  /** Injectable clock for deterministic tests; defaults to the wall clock. */
  now?: Date;
}

const EMPTY_PLAN: Omit<MarkdownTwinPlan, 'enabled'> = {
  writes: [],
  skips: [],
  userOwned: [],
  stalePaths: [],
  hasExistingGenerated: false,
  servedPaths: [],
  dynamicRouteCount: 0,
};

/** The twin's URL pathname for a route (`/` → `/index.md`, else `<route>.md`). */
export function twinPathnameForRoute(route: string): string {
  return route === '/' ? '/index.md' : `${route}.md`;
}

/**
 * Plans this build's markdown twins — pure computation, no writes, so the CLI can show the plan at
 * the review gate before anything lands on disk. Async because Tier-2 conversion lazy-loads the
 * converter (and only when prerendered HTML actually exists).
 */
export async function planMarkdownTwins(
  options: PlanMarkdownTwinsOptions,
): Promise<MarkdownTwinPlan> {
  if (!options.enabled) return { enabled: false, ...EMPTY_PLAN };

  const { cwd, router } = options;
  const publicDir = join(cwd, 'public');
  const now = options.now ?? new Date();

  const writes: PlannedTwin[] = [];
  const skips: TwinSkip[] = [];
  const userOwned: UserOwnedTwin[] = [];
  const covered = new Set<string>();

  const skip = (route: string, reason: TwinSkipReason): void => {
    covered.add(route);
    skips.push({ route, reason, detail: SKIP_DETAIL[reason] });
  };

  const planWrite = (twin: Omit<PlannedTwin, 'servedPath' | 'filePath'>): void => {
    covered.add(twin.route);
    const pathname = twinPathnameForRoute(twin.route);
    writes.push({
      ...twin,
      servedPath: servedPath(options.basePath, pathname),
      filePath: join(publicDir, ...pathname.split('/').filter((s) => s !== '')),
    });
  };

  const frontmatterFor = (route: string, title: string | undefined, description?: string) =>
    renderFrontmatter({
      title: title ?? route,
      ...(description !== undefined ? { description } : {}),
      canonicalUrl: absoluteOrServedUrl(options.siteUrl, options.basePath, route),
      lastUpdated: now.toISOString(),
    });

  // A user-authored markdown source that already covers a route wins over anything ax would
  // derive — the markdown is the source. Two shapes: a marker-less `public/<route>.md`, and a
  // markdown route handler (`app/<route>.md/route.*`) already serving the twin URL.
  const claimUserOwned = (route: string): boolean => {
    const pathname = twinPathnameForRoute(route);
    const publicFile = join(publicDir, ...pathname.split('/').filter((s) => s !== ''));
    if (existsSync(publicFile)) {
      let content: string;
      try {
        content = readFileSync(publicFile, 'utf8');
      } catch {
        return false;
      }
      if (!isGeneratedMarkdown(content)) {
        covered.add(route);
        userOwned.push({
          route,
          servedPath: servedPath(options.basePath, pathname),
          sourcePath: relative(cwd, publicFile),
        });
        return true;
      }
      return false;
    }
    if (router.appDir !== undefined) {
      const handlerDir = join(router.appDir, ...`${pathname}`.split('/').filter((s) => s !== ''));
      for (const name of ROUTE_FILE_NAMES) {
        const handler = join(handlerDir, name);
        if (existsSync(handler)) {
          covered.add(route);
          userOwned.push({
            route,
            servedPath: servedPath(options.basePath, pathname),
            sourcePath: relative(cwd, handler),
          });
          return true;
        }
      }
    }
    return false;
  };

  const gated = (route: string): boolean =>
    options.isGated({ kind: 'page', path: servedPath(options.basePath, route) });

  // --- Tier 1: MDX pages whose extension `pageExtensions` actually routes. ---
  if (router.appDir !== undefined) {
    const extensions = new Set(options.pageExtensions ?? []);
    for (const page of listMdxPageFiles(router.appDir)) {
      const ext = page.file.endsWith('.mdx') ? 'mdx' : 'md';
      if (!extensions.has(ext)) continue; // not served by Next — not a route, so not a twin target
      if (claimUserOwned(page.route)) continue;
      if (gated(page.route)) {
        skip(page.route, 'gated');
        continue;
      }
      let source: string;
      try {
        source = readFileSync(page.file, 'utf8');
      } catch {
        continue;
      }
      const derived = deriveMdxTwin(source);
      if (!derived.ok) {
        skip(page.route, derived.reason);
        if (derived.reason === 'mostly-jsx') {
          options.recommend(
            `${relative(cwd, page.file)} is mostly imports/JSX, so no markdown twin was derived ` +
              'for it — a twin built by deleting its components would misrepresent the page. Move ' +
              'the prose into markdown to get a source-fidelity twin.',
          );
        }
        continue;
      }
      planWrite({
        route: page.route,
        tier: 1,
        source: 'mdx',
        content: `${frontmatterFor(page.route, derived.title, derived.description)}\n${derived.markdown}`,
      });
    }
  }

  // --- Tier 2: prerendered HTML from the build output, for every remaining static route. ---
  const htmlLookup = buildPrerenderedHtmlLookup(cwd, options.distDir ?? '.next');
  for (const route of router.listPageRoutes()) {
    if (covered.has(route)) continue;
    if (claimUserOwned(route)) continue;
    if (gated(route)) {
      skip(route, 'gated');
      continue;
    }
    const htmlPath = htmlLookup.get(route);
    if (htmlPath === undefined) {
      skip(route, 'not-prerendered');
      continue;
    }
    let html: string;
    try {
      html = readFileSync(htmlPath, 'utf8');
    } catch (err) {
      options.warn(
        `Could not read the prerendered HTML for ${route} (${(err as Error).message}) — no twin.`,
      );
      skip(route, 'not-prerendered');
      continue;
    }
    const derived = await deriveHtmlTwin(html);
    if (!derived.ok) {
      skip(route, derived.reason);
      continue;
    }
    planWrite({
      route,
      tier: 2,
      source: 'prerender',
      content: `${frontmatterFor(route, derived.title, derived.description)}\n${derived.markdown}`,
    });
  }

  // --- Tier 3: dynamic routes have no statically knowable URL — counted, recommended, refused. ---
  const dynamicRouteCount = countDynamicPageFiles(router);
  if (dynamicRouteCount > 0) {
    options.recommend(
      `${dynamicRouteCount} page file${dynamicRouteCount === 1 ? ' has' : 's have'} dynamic URL ` +
        'segments, so no markdown twins exist for them (no build-time HTML, and ax never guesses ' +
        'URLs). To give those pages a markdown representation, add a markdown source per page or ' +
        'prerender representative routes.',
    );
  }

  // Stale sweep: a generated twin this run didn't (re)produce shadows a route that no longer
  // exists or no longer qualifies — left on disk it would keep lying, so it's deleted at apply.
  const planned = new Set(writes.map((twin) => twin.filePath));
  const stalePaths: string[] = [];
  let hasExistingGenerated = false;
  for (const file of listGeneratedTwinFiles(publicDir)) {
    hasExistingGenerated = true;
    if (!planned.has(file)) stalePaths.push(file);
  }

  const servedPaths = [
    ...writes.map((twin) => twin.servedPath),
    ...userOwned.map((twin) => twin.servedPath),
  ].sort();

  return {
    enabled: true,
    writes,
    skips,
    userOwned,
    stalePaths,
    hasExistingGenerated,
    servedPaths,
    dynamicRouteCount,
  };
}

/** Every `.md` under `public/` carrying the generated-by marker — ax's own previous output. */
function listGeneratedTwinFiles(publicDir: string): string[] {
  if (!existsSync(publicDir)) return [];
  const files: string[] = [];
  for (const file of walkFiles(publicDir, (name) => name.endsWith('.md'))) {
    // auth.md is generated too but is not a route twin; its lifecycle is managed by auth-md.ts.
    if (file.relativeDir === '' && file.absolutePath.endsWith(`${sep}auth.md`)) continue;
    try {
      if (isGeneratedMarkdown(readFileSync(file.absolutePath, 'utf8'))) {
        files.push(file.absolutePath);
      }
    } catch {
      // unreadable — leave it alone
    }
  }
  return files.sort();
}

/**
 * Maps every prerendered route to its HTML file in the build output. The output layout
 * (`<distDir>/server/app/**.html`, `<distDir>/server/pages/**.html`) is a semi-stable Next.js
 * internal, so this never throws: a missing directory just yields an empty map ("nothing is
 * prerendered"), and route-group segments (`(name)`) in the app output are dropped when mapping a
 * file back to its URL.
 */
function buildPrerenderedHtmlLookup(cwd: string, distDir: string): Map<string, string> {
  const lookup = new Map<string, string>();

  // A route's HTML lands either flat (`docs/getting-started.html`) or as a nested index
  // (`docs/getting-started/index.html`) depending on the router/layout; both map to the same URL
  // (an `index` base name contributes no segment). First mapping wins on a collision.
  const addHtmlFile = (file: { absolutePath: string; relativeDir: string }): void => {
    const base = file.absolutePath.split(sep).pop() ?? '';
    const name = base.slice(0, -'.html'.length);
    if (name === '404' || name === '500' || name.startsWith('_')) return; // error pages/internals
    const segments = pathSegments(file.relativeDir).filter(
      (segment) => !(segment.startsWith('(') && segment.endsWith(')')), // route groups — no URL segment
    );
    if (name !== 'index') segments.push(name);
    const route = segments.length === 0 ? '/' : `/${segments.join('/')}`;
    if (!lookup.has(route)) lookup.set(route, file.absolutePath);
  };

  for (const out of [join(cwd, distDir, 'server', 'app'), join(cwd, distDir, 'server', 'pages')]) {
    if (!existsSync(out)) continue;
    for (const file of walkFiles(out, (name) => name.endsWith('.html'), new Set())) {
      addHtmlFile(file);
    }
  }

  return lookup;
}

/** Count of page files (either router) whose URL has dynamic segments — Tier 3's population. */
function countDynamicPageFiles(router: RouterModel): number {
  let count = 0;
  if (router.appDir !== undefined) {
    for (const file of walkFiles(router.appDir, (name) => /^page\.(?:tsx|jsx|js)$/.test(name))) {
      if (resolvePagePathname(file.absolutePath, router.appDir) === undefined) count++;
    }
  }
  if (router.pagesDir !== undefined) {
    for (const file of walkFiles(router.pagesDir, (name) =>
      /\.(?:tsx|jsx|ts|js|mjs|cjs)$/.test(name),
    )) {
      const rel = relative(router.pagesDir, file.absolutePath);
      if (pathSegments(rel)[0] === 'api') continue;
      if (!/\[/.test(rel)) continue; // only dynamic-segment files; specials are just non-routes
      if (resolvePagesPathname(file.absolutePath, router.pagesDir) === undefined) count++;
    }
  }
  return count;
}

export interface ApplyTwinPlanResult {
  /** The twins written this run. */
  written: PlannedTwin[];
  /** Stale generated twins deleted this run, relative to the project root. */
  deleted: string[];
}

/**
 * Applies a twin plan: writes every planned twin and deletes stale generated ones. Only ever
 * touches files the plan produced or files carrying the generated-by marker; any filesystem error
 * warns rather than throws — twins must never be why a build breaks.
 */
export function applyMarkdownTwinPlan(
  cwd: string,
  plan: MarkdownTwinPlan,
  warn: (message: string) => void,
): ApplyTwinPlanResult {
  const written: PlannedTwin[] = [];
  for (const twin of plan.writes) {
    try {
      mkdirSync(dirname(twin.filePath), { recursive: true });
      writeFileSync(twin.filePath, twin.content, 'utf8');
      written.push(twin);
    } catch (err) {
      warn(`Could not write the markdown twin ${twin.servedPath} (${(err as Error).message}).`);
    }
  }

  const deleted: string[] = [];
  for (const stale of plan.stalePaths) {
    try {
      rmSync(stale, { force: true });
      deleted.push(relative(cwd, stale));
    } catch (err) {
      warn(`Could not remove the stale twin ${relative(cwd, stale)} (${(err as Error).message}).`);
    }
  }

  return { written, deleted };
}
