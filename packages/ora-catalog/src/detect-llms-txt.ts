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
  /** `ard.config` `scaffoldLlmsTxt`, resolved. Opt-in — defaults to `false`. */
  scaffold: boolean;
}

export interface DetectLlmsTxtResult {
  entry?: CatalogEntry;
  /** Path of a starter route handler scaffolded on *this* run, if any. */
  scaffoldedPath?: string;
}

const STARTER_ROUTE_TS = `// Starter llms.txt, scaffolded by ora-catalog because no llms.txt was found.
// Edit the content below, then commit this file — ora-catalog will detect and reference it as
// soon as it's live on your next build (this run's catalog can't reference it: nothing served it
// during the build that just ran).
export const dynamic = 'force-static';

export function GET(): Response {
  const body = \`# Your site

> Add a one-line description of your site for AI agents here.

## Docs

- [Add a link to your documentation](https://example.com)
\`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
`;

const STARTER_ROUTE_JS = `// Starter llms.txt, scaffolded by ora-catalog because no llms.txt was found.
// Edit the content below, then commit this file — ora-catalog will detect and reference it as
// soon as it's live on your next build (this run's catalog can't reference it: nothing served it
// during the build that just ran).
export const dynamic = 'force-static';

export function GET() {
  const body = \`# Your site

> Add a one-line description of your site for AI agents here.

## Docs

- [Add a link to your documentation](https://example.com)
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
        'Found an existing llms.txt but no site URL is known — set "siteUrl" in ard.config, or ' +
          'deploy on Vercel, to include it in the catalog.',
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

  if (!options.scaffold) return {};

  const scaffoldedPath = scaffoldLlmsTxtRoute(options.cwd, appDir, options.warn);
  return scaffoldedPath ? { scaffoldedPath } : {};
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
    `Scaffolded a starter llms.txt at ${routeFile} — edit its content and commit it; ora-catalog ` +
      'will reference /llms.txt starting with your next build.',
  );
  return routeFile;
}
