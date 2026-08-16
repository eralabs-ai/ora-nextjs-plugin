import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { catalogServedPath } from './discovery.js';
import { buildRouterModel, type RouterModel } from './router-model.js';
import { readSiteMetadata, type SiteMetadata } from './site-metadata.js';
import { buildArtifactUrl, buildUrn, NO_SITE_URL_HINT } from './site-url.js';
import type { CatalogEntry } from './types.js';
import { ROUTE_FILE_NAMES } from './walk-files.js';

/** What this build produced or detected, for the scaffold's "Machine-readable resources" section. */
export interface LlmsTxtResources {
  /** Whether a `public/openapi.json` was detected. */
  openApi?: boolean;
  /** Pathnames of detected `mcp-handler` mounts (e.g. `/mcp`). */
  mcpPathnames?: string[];
}

export interface DetectLlmsTxtOptions {
  cwd: string;
  siteUrl: string | undefined;
  basePath: string;
  warn: (message: string) => void;
  /**
   * Advisory recommendation channel (not a warning — nothing is broken). Optional so the detector
   * can run standalone; `generateCatalog` always supplies it. Emits a "recommend adding an llms.txt"
   * nudge when none is present and scaffolding wasn't opted into.
   */
  recommend?: (message: string) => void;
  /** `ax.config` `scaffoldLlmsTxt`, resolved. Opt-in — defaults to `false`. */
  scaffold: boolean;
  /** `package.json` facts for the scaffold's title/description. Read from `cwd` when omitted. */
  site?: SiteMetadata;
  /** Artifacts the scaffold links to. Only what this build actually found is ever listed. */
  resources?: LlmsTxtResources;
  /** The shared router model. Built from `cwd` when omitted, so the detector runs standalone. */
  router?: RouterModel;
}

// llms.txt and JSON-LD structured data are complementary discovery signals, so each detector points
// at the other: llms.txt is a natural-language guide that tells an agent *what your site is for* and
// whether it fits the task at hand, while JSON-LD identifies you as an *entity* (Organization +
// sameAs) that registries can disambiguate and rank. One without the other leaves a gap — an agent
// that can tell you're relevant but can't identify you, or vice versa — so acting on a single
// recommendation in isolation only gets you part of the way.
const LLMS_TXT_ABSENT_RECOMMENDATION =
  'No llms.txt found — a short natural-language guide agents read to decide whether your site fits ' +
  'their task, and to find your key pages. Add one at app/llms.txt/route.ts (or public/llms.txt), ' +
  'or set scaffoldLlmsTxt: true in ax.config to have a starter written for you. Pair it with ' +
  'JSON-LD structured data (an Organization block with a sameAs array): llms.txt says what your ' +
  'site is for, JSON-LD identifies it as an entity registries can rank — the two reinforce each ' +
  'other, so add both rather than one alone.';

export interface DetectLlmsTxtResult {
  entry?: CatalogEntry;
  /** Whether an llms.txt source exists at all — true even when no entry could be built (no siteUrl). */
  found: boolean;
  /** The detected source path relative to the project root, if any. */
  source?: string;
  /** Path of a starter route handler scaffolded on *this* run, if any. */
  scaffoldedPath?: string;
  /**
   * The markdown body a scaffold serves at `/llms.txt` — the bytes an agent fetches, which for an
   * App Router route handler differ from the `route.ts` file on disk (the body is wrapped in JS).
   * Present only when a scaffold was written this run; lets size reporting measure the response.
   */
  scaffoldedBody?: string;
}

/** Cap on routes listed under "Key pages" — an orientation aid, not a sitemap replacement. */
const MAX_KEY_PAGES = 25;

/**
 * Detect-and-reference for `llms.txt`, served either as an App Router route handler at
 * `app/llms.txt/route.*` or as a static `public/llms.txt`. When neither exists and the caller
 * opted in via `scaffoldLlmsTxt: true`, scaffolds a starter so a *future* build serves one — an App
 * Router route handler when the project has an `app/` dir (the idiomatic App Router way), otherwise
 * a static `public/llms.txt` (a Pages Router app can't serve `/llms.txt` from `pages/api` at the
 * right path, so the static file — served identically by either router — is the honest target).
 * This run's catalog never references a path nothing served during the build that just ran.
 * Scaffolding is opt-in (default `false`): unlike every other detector here, it writes a *second*
 * file into the consumer's own source tree, which is a bigger, more visible action than just
 * producing the one catalog file this plugin exists to produce.
 */
export function detectLlmsTxt(options: DetectLlmsTxtOptions): DetectLlmsTxtResult {
  const router = options.router ?? buildRouterModel(options.cwd);
  const routeFile = router.appDir ? findLlmsTxtRoute(router.appDir) : undefined;
  const staticFile = join(options.cwd, 'public', 'llms.txt');
  const sourceFile = routeFile ?? (existsSync(staticFile) ? staticFile : undefined);

  if (sourceFile) {
    const source = relative(options.cwd, sourceFile);
    if (!options.siteUrl) {
      options.warn(`Found an existing llms.txt but no site URL is known — ${NO_SITE_URL_HINT}`);
      return { found: true, source };
    }
    return {
      found: true,
      source,
      entry: {
        identifier: buildUrn(options.siteUrl, 'llms-txt'),
        type: 'text/markdown',
        displayName: 'llms.txt',
        url: buildArtifactUrl(options.siteUrl, options.basePath, '/llms.txt'),
        updatedAt: statSync(sourceFile).mtime.toISOString(),
      },
    };
  }

  if (!options.scaffold) {
    options.recommend?.(LLMS_TXT_ABSENT_RECOMMENDATION);
    return { found: false };
  }

  const scaffolded = scaffoldLlmsTxt(options, router);
  if (scaffolded) {
    return { found: false, scaffoldedPath: scaffolded.path, scaffoldedBody: scaffolded.body };
  }

  // Opted into scaffolding but nothing was written (no app/ dir, or a write error already warned
  // about) — still surface the absent nudge so the signal isn't silently dropped.
  options.recommend?.(LLMS_TXT_ABSENT_RECOMMENDATION);
  return { found: false };
}

/** Finds a `route.*` file directly inside `<appDir>/llms.txt/`, if any. */
function findLlmsTxtRoute(appDir: string): string | undefined {
  const dir = join(appDir, 'llms.txt');
  if (!existsSync(dir)) return undefined;

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const match = names.find((name) => ROUTE_FILE_NAMES.has(name));
  return match ? join(dir, match) : undefined;
}

/**
 * Scaffolds a starter llms.txt into the router-appropriate location: an `app/llms.txt/route.{ts,js}`
 * handler when the project has an App Router, otherwise a static `public/llms.txt`. Never overwrites
 * (callers only reach here once neither a route nor a static file was found); any filesystem error
 * is caught and warned about rather than failing the build — writing a *helpful extra* file must
 * never be why a build breaks. Returns undefined when the project has no router to scaffold for.
 */
function scaffoldLlmsTxt(
  options: DetectLlmsTxtOptions,
  router: RouterModel,
): { path: string; body: string } | undefined {
  if (router.appDir) return scaffoldLlmsTxtRoute(options, router, router.appDir);
  if (router.pagesDir) return scaffoldLlmsTxtStatic(options, router);
  return undefined;
}

/** Writes a starter App Router `app/llms.txt/route.{ts,js}` handler; returns its path + served body. */
function scaffoldLlmsTxtRoute(
  options: DetectLlmsTxtOptions,
  router: RouterModel,
  appDir: string,
): { path: string; body: string } | undefined {
  const { cwd, warn } = options;
  const useTypeScript = existsSync(join(cwd, 'tsconfig.json'));
  const routeDir = join(appDir, 'llms.txt');
  const routeFile = join(routeDir, useTypeScript ? 'route.ts' : 'route.js');
  const body = buildLlmsTxtBody(options, router);

  try {
    if (existsSync(routeFile)) return undefined;
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(routeFile, starterRouteSource(body, useTypeScript), 'utf8');
  } catch (err) {
    warn(
      `Tried to scaffold a starter llms.txt at ${routeFile} but couldn't (${(err as Error).message}).`,
    );
    return undefined;
  }

  warn(scaffoldedNotice(routeFile));
  return { path: routeFile, body };
}

/**
 * Writes a starter static `public/llms.txt` — the Pages Router path, since a Pages Router app can't
 * serve `/llms.txt` from `pages/api` at the correct URL without a rewrite. The file is plain
 * markdown (no route handler wrapper), served identically to an App Router route at `/llms.txt`.
 */
function scaffoldLlmsTxtStatic(
  options: DetectLlmsTxtOptions,
  router: RouterModel,
): { path: string; body: string } | undefined {
  const { cwd, warn } = options;
  const publicDir = join(cwd, 'public');
  const filePath = join(publicDir, 'llms.txt');
  const body = buildLlmsTxtBody(options, router);

  try {
    if (existsSync(filePath)) return undefined;
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(filePath, body, 'utf8');
  } catch (err) {
    warn(
      `Tried to scaffold a starter llms.txt at ${filePath} but couldn't (${(err as Error).message}).`,
    );
    return undefined;
  }

  warn(scaffoldedNotice(filePath));
  return { path: filePath, body };
}

function scaffoldedNotice(path: string): string {
  return (
    `Scaffolded a starter llms.txt at ${path} — ax filled in what it can derive (your ` +
    'package.json name and description, your real routes, and the machine-readable artifacts ' +
    'this build produced). Write the "When to use" section yourself: it is the one part no build ' +
    'tool can derive, and the part that tells an agent whether your site fits its task. Commit ' +
    'the file and ax will reference /llms.txt starting with your next build. Pair it with ' +
    'JSON-LD structured data (Organization + sameAs): llms.txt says what your site is for, ' +
    'JSON-LD identifies it as an entity registries can rank — add both, not one alone.'
  );
}

/**
 * The starter route handler. The markdown body is embedded as a template literal so the file stays
 * pleasant to edit (this is a file the developer is meant to own), which means every derived value
 * — a package.json description, a route path — has to be escaped against backticks and `${`.
 */
function starterRouteSource(body: string, useTypeScript: boolean): string {
  const signature = useTypeScript ? 'export function GET(): Response {' : 'export function GET() {';
  return `// Starter llms.txt, scaffolded by ax because no llms.txt was found. This file is yours:
// edit it freely, ax never overwrites it.
//
// The title, description, key pages and machine-readable resources below were derived from your
// package.json and your source tree. The "When to use" section was not — nothing at build time
// knows what agents should come here for, and that section is the whole point of an llms.txt, so
// it ships as a TODO for you (or your coding agent) to replace.
export const dynamic = 'force-static';

${signature}
  const body = \`${escapeTemplateLiteral(body)}\`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
`;
}

/** Escapes text for embedding in a JavaScript template literal. */
function escapeTemplateLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * The generated llms.txt content. Everything here is either a fact this build read off disk or an
 * explicitly-marked TODO — never invented prose about a site ax knows nothing about.
 */
function buildLlmsTxtBody(options: DetectLlmsTxtOptions, router: RouterModel): string {
  const site = options.site ?? readSiteMetadata(options.cwd);
  const sections: string[] = [`# ${site.displayName}`];

  if (site.description !== undefined) sections.push(`> ${site.description}`);

  sections.push(
    '## When to use\n\n' +
      '<!-- TODO: replace the placeholders below with the real tasks an agent should come to this\n' +
      '     site for ("check the status of an order", "compare pricing tiers before recommending a\n' +
      '     plan"). Agent-readiness checks look for genuine "When to use" guidance, and a\n' +
      '     placeholder earns no credit — an unedited section here scores the same as none at all. -->\n\n' +
      '- TODO: a task an agent should use this site for\n' +
      '- TODO: another representative use case',
    '## When not to use\n\n- TODO: a task this site is the wrong source for',
  );

  const keyPages = buildKeyPages(options, router);
  if (keyPages.length > 0) {
    sections.push(`## Key pages\n\n${keyPages.join('\n')}`);
  }

  sections.push(`## Machine-readable resources\n\n${buildResourceLinks(options).join('\n')}`);

  return `${sections.join('\n\n')}\n`;
}

/** The app's real, statically addressable routes — never dynamic segments, never guessed URLs. */
function buildKeyPages(options: DetectLlmsTxtOptions, router: RouterModel): string[] {
  return router
    .listPageRoutes()
    .slice(0, MAX_KEY_PAGES)
    .map((route) => `- [${route}](${absoluteOrServed(options, route)})`);
}

/** Links to the artifacts this build actually produced or detected — nothing speculative. */
function buildResourceLinks(options: DetectLlmsTxtOptions): string[] {
  const links = [
    `- [AI Catalog](${absoluteOrServed(options, catalogServedPath(options.basePath), true)}) — ` +
      'every machine-readable artifact this site offers agents',
  ];

  if (options.resources?.openApi === true) {
    links.push(
      `- [OpenAPI](${absoluteOrServed(options, '/openapi.json')}) — this site's HTTP API: routes, ` +
        'schemas, and auth',
    );
  }
  for (const pathname of options.resources?.mcpPathnames ?? []) {
    links.push(
      `- [MCP server](${absoluteOrServed(options, pathname)}) — callable tools over the Model ` +
        'Context Protocol',
    );
  }
  return links;
}

/**
 * An absolute URL when the site origin resolved, and the served (basePath-prefixed) path otherwise.
 * A relative path in an llms.txt is still resolvable by whoever fetched the file, so this degrades
 * usefully rather than emitting a guessed origin. `preResolved` marks a path that already carries
 * the basePath prefix.
 */
function absoluteOrServed(
  options: DetectLlmsTxtOptions,
  pathname: string,
  preResolved = false,
): string {
  if (options.siteUrl === undefined) {
    return preResolved ? pathname : `${normalizedBasePath(options.basePath)}${pathname}`;
  }
  return preResolved
    ? `${options.siteUrl}${pathname}`
    : buildArtifactUrl(options.siteUrl, options.basePath, pathname);
}

function normalizedBasePath(basePath: string): string {
  return basePath === '/' ? '' : basePath.replace(/\/$/, '');
}
