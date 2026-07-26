import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';
import { buildArtifactUrl, buildUrn } from './site-url.js';
import type { CatalogEntry } from './types.js';
import { ROUTE_FILE_NAMES } from './walk-files.js';

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
  /** `ard.config` `scaffoldLlmsTxt`, resolved. Opt-in — defaults to `false`. */
  scaffold: boolean;
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
  'or set scaffoldLlmsTxt: true in ard.config to have a starter written for you. Pair it with ' +
  'JSON-LD structured data (an Organization block with a sameAs array): llms.txt says what your ' +
  'site is for, JSON-LD identifies it as an entity registries can rank — the two reinforce each ' +
  'other, so add both rather than one alone.';

export interface DetectLlmsTxtResult {
  entry?: CatalogEntry;
  /** Path of a starter route handler scaffolded on *this* run, if any. */
  scaffoldedPath?: string;
}

const STARTER_ROUTE_TS = `// Starter llms.txt, scaffolded by ora-catalog because no llms.txt was found.
// Fill in the sections below — especially "When to use" (this is what tells an agent whether your
// site is relevant to its task) — then commit this file. ora-catalog references
// /llms.txt on your next build (this run's catalog can't: nothing served it during the build that
// just ran).
export const dynamic = 'force-static';

export function GET(): Response {
  const body = \`# Your site

> Add a one-line description of your site for AI agents here.

## When to use

- Describe a task an agent should use this site for
- Add another representative use case

## When NOT to use

- Describe when an agent should not use this site

## Key pages

- [Docs](https://example.com/docs)
- [Pricing](https://example.com/pricing)
\`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
`;

const STARTER_ROUTE_JS = `// Starter llms.txt, scaffolded by ora-catalog because no llms.txt was found.
// Fill in the sections below — especially "When to use" (this is what tells an agent whether your
// site is relevant to its task) — then commit this file. ora-catalog references
// /llms.txt on your next build (this run's catalog can't: nothing served it during the build that
// just ran).
export const dynamic = 'force-static';

export function GET() {
  const body = \`# Your site

> Add a one-line description of your site for AI agents here.

## When to use

- Describe a task an agent should use this site for
- Add another representative use case

## When NOT to use

- Describe when an agent should not use this site

## Key pages

- [Docs](https://example.com/docs)
- [Pricing](https://example.com/pricing)
\`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
`;

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
    if (!options.siteUrl) {
      options.warn(
        'Found an existing llms.txt but no site URL is known — set "siteUrl" in ard.config, or set ' +
          'a SITE_URL (or NEXT_PUBLIC_SITE_URL) env var, to include it in the catalog. Either works ' +
          'in a local build, so you can generate and check the catalog before deploying.',
      );
      return {};
    }
    return {
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
    return {};
  }

  const scaffoldedPath = scaffoldLlmsTxtRoute(options.cwd, appDir, options.warn);
  if (scaffoldedPath) return { scaffoldedPath };

  // Opted into scaffolding but nothing was written (no app/ dir, or a write error already warned
  // about) — still surface the absent nudge so the signal isn't silently dropped.
  options.recommend?.(LLMS_TXT_ABSENT_RECOMMENDATION);
  return {};
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
  cwd: string,
  appDir: string | undefined,
  warn: (message: string) => void,
): string | undefined {
  if (!appDir) return undefined;

  const useTypeScript = existsSync(join(cwd, 'tsconfig.json'));
  const routeDir = join(appDir, 'llms.txt');
  const routeFile = join(routeDir, useTypeScript ? 'route.ts' : 'route.js');

  try {
    if (existsSync(routeFile)) return undefined;
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(routeFile, useTypeScript ? STARTER_ROUTE_TS : STARTER_ROUTE_JS, 'utf8');
  } catch (err) {
    warn(
      `Tried to scaffold a starter llms.txt at ${routeFile} but couldn't (${(err as Error).message}).`,
    );
    return undefined;
  }

  warn(
    `Scaffolded a starter llms.txt at ${routeFile} — fill in its content (especially the "When to ` +
      'use" section, since that\'s what tells an agent whether your site is relevant to its task) ' +
      'and commit it; ora-catalog will reference /llms.txt starting with your next build. Pair it ' +
      'with JSON-LD structured data (Organization + sameAs): llms.txt says what your site is for, ' +
      'JSON-LD identifies it as an entity registries can rank — add both, not one alone.',
  );
  return routeFile;
}
