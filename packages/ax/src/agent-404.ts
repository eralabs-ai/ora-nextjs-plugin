import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { isGeneratedMarkdown, renderFrontmatter } from './markdown-artifact.js';
import type { ServingManifestData } from './manifest.js';
import { renderWayfinding } from './middleware/wayfinding.js';
import { buildRouterModel, type RouterModel } from './router-model.js';
import { absoluteOrServedUrl, servedPath } from './site-url.js';
import { walkFiles } from './walk-files.js';

// Agent-aware 404. When an AI agent fetches a URL that doesn't exist, a default 404 page is a
// dead end: the agent either gives up or hallucinates a next step. Mintlify's crawl benchmark
// found that a single llms.txt link on error responses eliminates most agent 404 dead-ends, and
// Vercel's agent-readability guidance recommends signposting llms.txt from every response.
//
// The division of labor here keeps the two audiences' surfaces apart. The human-visible 404 page
// is the site owner's design domain — ax never writes or scaffolds one. ax's contribution is the
// machine artifact: a generated `public/404.md` (the "404 wayfinding guide" — discovery links plus
// the routes that do exist, rendered by the same `renderWayfinding` the negotiation middleware
// serves, so the two channels can never disagree), plus a detect-and-recommend pass asking the
// site's own 404 page(s) to carry one `<link rel="alternate" type="text/markdown">` tag pointing
// at it. The tag is invisible to human visitors; an agent that fetched the HTML 404 follows it to
// the markdown guide in one hop.
//
// Detection is granular on purpose. The App Router's `not-found.tsx` is per-segment: a
// `notFound()` thrown inside `app/docs/[slug]/page.tsx` renders the *nearest* `not-found` file
// (e.g. `app/docs/not-found.tsx`), bypassing the root one — and those data-driven misses on
// dynamic routes are exactly the ones the middleware structurally can't answer (the URL matches a
// route pattern, so whether it exists is only knowable at request time). So the detector scans
// every `app/**/not-found.*` plus the Pages Router's root `pages/404.*`, and each file is asked to
// carry the link.

/** The 404 wayfinding guide's URL pathname (basePath-prefixed at serve time). */
export const NOT_FOUND_MD_PATHNAME = '/404.md';

/**
 * Signals that a 404 page already points agents onward: the wayfinding-guide link this module asks
 * for, or direct signposts (llms.txt / the AI Catalog) a hand-built page may carry instead.
 */
const AGENT_SIGNPOST_RE = /404\.md|llms\.txt|ai-catalog/;

/** App Router 404 file names — valid at the root and in any route segment. */
const APP_NOT_FOUND_NAMES: ReadonlySet<string> = new Set([
  'not-found.tsx',
  'not-found.jsx',
  'not-found.js',
]);

/** Pages Router 404 file names — root-level only (that router has no per-segment 404). */
const PAGES_404_NAMES = ['404.tsx', '404.jsx', '404.js'];

export interface Agent404Options {
  cwd: string;
  /** `next.config` `basePath`, or `''` if unset — the recommended link href is served under it. */
  basePath: string;
  /**
   * Whether this build generates `public/404.md` (markdownTwins on, a router present). Off, the
   * recommendations can't ask for a link to a file that won't exist, so they ask to re-enable the
   * feature instead.
   */
  notFoundMdPlanned: boolean;
  recommend: (message: string) => void;
  /** The shared router model. Built from `cwd` when omitted, so the detector runs standalone. */
  router?: RouterModel;
}

/** One detected 404 page and whether it signposts agents. */
export interface Detected404Page {
  /** Source path relative to the project root. */
  source: string;
  /** Whether the page links agents onward (`/404.md`, llms.txt, or the AI Catalog). */
  agentAware: boolean;
}

export interface Agent404Result {
  /** Whether any 404 page exists (root or segment-level, either router). */
  notFoundPresent: boolean;
  /** True only when every detected 404 page signposts agents; false when none exists. */
  agentAware: boolean;
  /** Every detected 404 page: `app/**` `not-found.*` (root and per-segment) plus `pages/404.*`. */
  pages: Detected404Page[];
}

/**
 * Detect-and-recommend for the site's 404 pages. Read-only by design: the human-visible 404 is the
 * user's page in the user's design system, so ax only ever asks — for a page where none exists, or
 * for the one alternate-link tag where a page doesn't carry it. Never throws; an unreadable file
 * just reads as not agent-aware.
 */
export function detectAgent404(options: Agent404Options): Agent404Result {
  const { cwd, recommend } = options;
  const router = options.router ?? buildRouterModel(cwd);

  const files: string[] = [];
  if (router.appDir !== undefined) {
    for (const file of walkFiles(router.appDir, (name) => APP_NOT_FOUND_NAMES.has(name))) {
      files.push(file.absolutePath);
    }
  }
  if (router.pagesDir !== undefined) {
    const pagesDir = router.pagesDir;
    for (const name of PAGES_404_NAMES) {
      const path = join(pagesDir, name);
      if (existsSync(path)) files.push(path);
    }
  }

  const pages: Detected404Page[] = files
    .map((file) => ({ source: relative(cwd, file), agentAware: fileMentionsSignposts(file) }))
    .sort((a, b) => a.source.localeCompare(b.source));

  const guidePath = servedPath(options.basePath, NOT_FOUND_MD_PATHNAME);
  const linkTag = `<link rel="alternate" type="text/markdown" href="${guidePath}" />`;
  const guideClause = options.notFoundMdPlanned
    ? `${guidePath} — the generated wayfinding guide (real routes + discovery links) this build writes`
    : `${guidePath}, the generated wayfinding guide — currently NOT written because markdownTwins ` +
      'is disabled in ax.config; set it back to true first';

  if (pages.length === 0) {
    // Which page to create follows the primary router's convention; the design is the user's.
    const conventionPath =
      router.primary === 'app' && router.appDir !== undefined
        ? `${relative(cwd, router.appDir)}/not-found.tsx`
        : router.primary === 'pages' && router.pagesDir !== undefined
          ? `${relative(cwd, router.pagesDir)}/404.tsx`
          : undefined;
    if (conventionPath !== undefined) {
      recommend(
        `No ${conventionPath} found — agents that hit a missing URL get Next.js’s bare default ` +
          '404, a dead end that makes them give up or guess. Add a standard 404 page in your own ' +
          'design system (a clear “page not found” and a way back home), and include ' +
          `\`${linkTag}\` so agents can hop from it to ${guideClause}. Rendered in the page’s ` +
          'JSX, React hoists the tag into <head> (App Router); use next/head in the Pages Router.',
      );
    }
    return { notFoundPresent: false, agentAware: false, pages };
  }

  const unlinked = pages.filter((page) => !page.agentAware);
  if (unlinked.length > 0) {
    const list = unlinked.map((page) => page.source).join(', ');
    const plural = unlinked.length !== 1;
    recommend(
      `${list} do${plural ? '' : 'es'}n’t point agents anywhere — an agent hitting a 404 needs ` +
        'to know why (the URL doesn’t exist; retrying won’t help) and how to continue. Add ' +
        `\`${linkTag}\` to ${plural ? 'each page' : 'it'} so agents can hop to ${guideClause}. ` +
        'The tag is invisible to human visitors, and your page stays yours — ax never edits it.',
    );
  }

  return { notFoundPresent: true, agentAware: unlinked.length === 0, pages };
}

function fileMentionsSignposts(path: string): boolean {
  try {
    return AGENT_SIGNPOST_RE.test(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
}

export interface NotFoundMdPlan {
  /** Full file contents (frontmatter + wayfinding body). */
  content: string;
  /** Served URL path, basePath-prefixed. */
  servedPath: string;
  /** How many routes the guide's manifest lists (the body caps what it prints). */
  routeCount: number;
}

export interface BuildNotFoundMdOptions {
  /**
   * The serving-manifest data the guide renders from. The caller overlays this run's own outputs
   * (planned twins, the auth guide, the catalog) so the guide describes the build it ships with,
   * not the previous one.
   */
  manifest: ServingManifestData;
  siteUrl: string | undefined;
  basePath: string;
  siteDisplayName: string;
  /** Injectable clock for deterministic tests; defaults to the wall clock. */
  now?: Date;
}

/**
 * Builds the generated `public/404.md` — the fixed-path twin of "you hit a dead end": the same
 * wayfinding body the negotiation middleware serves rendered without a request URL, under the
 * standard generated-markdown frontmatter. Pure — the CLI writes it (see
 * {@link applyNotFoundMdPlan}) after the review gate, alongside the twins and the auth guide.
 */
export function buildNotFoundMd(options: BuildNotFoundMdOptions): NotFoundMdPlan {
  const now = options.now ?? new Date();
  const frontmatter = renderFrontmatter({
    title: `Page not found — ${options.siteDisplayName}`,
    description:
      'Where to continue when a URL on this site does not exist: discovery links and real routes.',
    canonicalUrl: absoluteOrServedUrl(options.siteUrl, options.basePath, NOT_FOUND_MD_PATHNAME),
    lastUpdated: now.toISOString(),
  });

  return {
    content: `${frontmatter}\n${renderWayfinding(options.manifest)}`,
    servedPath: servedPath(options.basePath, NOT_FOUND_MD_PATHNAME),
    routeCount: options.manifest.routes.length,
  };
}

export interface ApplyNotFoundMdResult {
  /** Path written, relative to the project root, when the plan was written. */
  written?: string;
  /** Path deleted (a previously generated 404.md this run no longer produces). */
  deleted?: string;
}

/**
 * Writes the planned `public/404.md`, or — when there is no plan — removes a previously
 * *generated* one (never a user-authored file: the generated-by marker is the guard, same as the
 * twins and auth.md). Filesystem errors warn rather than throw.
 */
export function applyNotFoundMdPlan(
  cwd: string,
  plan: NotFoundMdPlan | undefined,
  warn: (message: string) => void,
): ApplyNotFoundMdResult {
  const filePath = join(cwd, 'public', '404.md');

  if (plan === undefined) {
    if (!existsSync(filePath)) return {};
    try {
      if (!isGeneratedMarkdown(readFileSync(filePath, 'utf8'))) return {};
      rmSync(filePath, { force: true });
      return { deleted: relative(cwd, filePath) };
    } catch (err) {
      warn(`Could not remove the stale public/404.md (${(err as Error).message}).`);
      return {};
    }
  }

  try {
    if (existsSync(filePath) && !isGeneratedMarkdown(readFileSync(filePath, 'utf8'))) {
      warn(
        'public/404.md exists but was not generated by ax — leaving it untouched. Delete it if ' +
          'you want the generated 404 wayfinding guide instead.',
      );
      return {};
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, plan.content, 'utf8');
    return { written: relative(cwd, filePath) };
  } catch (err) {
    warn(`Could not write public/404.md (${(err as Error).message}).`);
    return {};
  }
}
