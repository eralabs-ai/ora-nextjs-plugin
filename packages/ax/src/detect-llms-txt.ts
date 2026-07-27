import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findAppDir, listStaticPageRoutes } from './app-dir.js';
import { catalogServedPath } from './discovery.js';
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
}

/** Cap on routes listed under "Key pages" — an orientation aid, not a sitemap replacement. */
const MAX_KEY_PAGES = 25;

/**
 * Detect-and-reference for `llms.txt`, served either as a route handler at
 * `app/llms.txt/route.*` or as a static `public/llms.txt`. When neither exists and the caller
 * opted in via `scaffoldLlmsTxt: true`, scaffolds a starter route handler so a *future* build
 * serves one — this run's catalog never references a path nothing served during the build that
 * just ran. Scaffolding is opt-in (default `false`): unlike every other detector here, it writes a
 * *second* file into the consumer's own source tree, which is a bigger, more visible action than
 * just producing the one catalog file this plugin exists to produce.
 */
export function detectLlmsTxt(options: DetectLlmsTxtOptions): DetectLlmsTxtResult {
  const appDir = findAppDir(options.cwd);
  const routeFile = appDir ? findLlmsTxtRoute(appDir) : undefined;
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

  const scaffoldedPath = scaffoldLlmsTxtRoute(options, appDir);
  if (scaffoldedPath) return { found: false, scaffoldedPath };

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
 * Writes a starter `app/llms.txt/route.{ts,js}`. Never overwrites (callers only reach here once
 * neither a route nor a static file was found); any filesystem error (e.g. `app/llms.txt` already
 * exists as a plain file) is caught and warned about rather than failing the build — writing a
 * *helpful extra* file must never be why a build breaks.
 */
function scaffoldLlmsTxtRoute(
  options: DetectLlmsTxtOptions,
  appDir: string | undefined,
): string | undefined {
  if (!appDir) return undefined;

  const { cwd, warn } = options;
  const useTypeScript = existsSync(join(cwd, 'tsconfig.json'));
  const routeDir = join(appDir, 'llms.txt');
  const routeFile = join(routeDir, useTypeScript ? 'route.ts' : 'route.js');

  try {
    if (existsSync(routeFile)) return undefined;
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(routeFile, starterRouteSource(options, appDir, useTypeScript), 'utf8');
  } catch (err) {
    warn(
      `Tried to scaffold a starter llms.txt at ${routeFile} but couldn't (${(err as Error).message}).`,
    );
    return undefined;
  }

  warn(
    `Scaffolded a starter llms.txt at ${routeFile} — ax filled in what it can derive (your ` +
      'package.json name and description, your real routes, and the machine-readable artifacts ' +
      'this build produced). Write the "When to use" section yourself: it is the one part no build ' +
      'tool can derive, and the part that tells an agent whether your site fits its task. Commit ' +
      'the file and ax will reference /llms.txt starting with your next build. Pair it with ' +
      'JSON-LD structured data (Organization + sameAs): llms.txt says what your site is for, ' +
      'JSON-LD identifies it as an entity registries can rank — add both, not one alone.',
  );
  return routeFile;
}

/**
 * The starter route handler. The markdown body is embedded as a template literal so the file stays
 * pleasant to edit (this is a file the developer is meant to own), which means every derived value
 * — a package.json description, a route path — has to be escaped against backticks and `${`.
 */
function starterRouteSource(
  options: DetectLlmsTxtOptions,
  appDir: string,
  useTypeScript: boolean,
): string {
  const signature = useTypeScript ? 'export function GET(): Response {' : 'export function GET() {';
  return `// Starter llms.txt, scaffolded by ax because no llms.txt was found. This file is yours:
// edit it freely, ax never overwrites it.
//
// The title, description, key pages and machine-readable resources below were derived from your
// package.json and your App Router source tree. The "When to use" section was not — nothing at
// build time knows what agents should come here for, and that section is the whole point of an
// llms.txt, so it ships as a TODO for you (or your coding agent) to replace.
export const dynamic = 'force-static';

${signature}
  const body = \`${escapeTemplateLiteral(buildLlmsTxtBody(options, appDir))}\`;

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
function buildLlmsTxtBody(options: DetectLlmsTxtOptions, appDir: string): string {
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

  const keyPages = buildKeyPages(options, appDir);
  if (keyPages.length > 0) {
    sections.push(`## Key pages\n\n${keyPages.join('\n')}`);
  }

  sections.push(`## Machine-readable resources\n\n${buildResourceLinks(options).join('\n')}`);

  return `${sections.join('\n\n')}\n`;
}

/** The app's real, statically addressable routes — never dynamic segments, never guessed URLs. */
function buildKeyPages(options: DetectLlmsTxtOptions, appDir: string): string[] {
  return listStaticPageRoutes(appDir)
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
