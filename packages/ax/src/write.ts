import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { findAppDir } from './app-dir.js';
import type { BuildReport } from './report.js';
import type { McpServerCard } from './server-card.js';
import type { AiCatalog } from './types.js';
import { formatCatalogErrors, validateCatalogArd } from './validate.js';

/** Where the static emission target lands, relative to the project root. */
export const CATALOG_OUTPUT_PATH = join('public', '.well-known', 'ai-catalog.json');

/** Where the static MCP server card lands (the well-known path agent registries probe). */
export const SERVER_CARD_OUTPUT_PATH = join('public', '.well-known', 'mcp', 'server-card.json');

/** Default path for the opt-in machine-readable build report — build output, never `public/`. */
export const REPORT_OUTPUT_PATH = join('.ora', 'report.json');

/** App Router route segments that serve the catalog for the `'route'` emission target. */
const CATALOG_ROUTE_SEGMENTS = ['.well-known', 'ai-catalog.json'];

/** App Router route segments that serve the MCP server card for the `'route'` emission target. */
const SERVER_CARD_ROUTE_SEGMENTS = ['.well-known', 'mcp', 'server-card.json'];

/** Media type of the MCP server card (SEP-1649 / PR-2127). */
const SERVER_CARD_CONTENT_TYPE = 'application/mcp-server-card+json';

export type EmissionTarget = 'static' | 'route';

export interface WriteCatalogOptions {
  /** Which emission target to write. Defaults to `'static'`. */
  target?: EmissionTarget;
  /** Non-fatal notices (e.g. a `'route'` request that has to fall back to `'static'`). */
  warn?: (message: string) => void;
}

export type WriteCatalogResult =
  { ok: true; path: string; target: EmissionTarget } | { ok: false; errors: string };

/**
 * Validates a catalog against the strict official ARD schema and, only if valid, writes it — either
 * as the static `public/.well-known/ai-catalog.json` (default) or as an App Router route handler at
 * `app/.well-known/ai-catalog.json/route.{ts,js}` (`target: 'route'`). Never writes an
 * invalid catalog — this is a hard-fail gate by design: a bad catalog is worse than none,
 * so it must never reach a real deployment. The strict (not permissive) schema gates here because
 * this is *emitted* output: it must survive the official conformance tool, not merely count as a
 * catalog.
 *
 * The static write is atomic (write to a temp file, then rename into place) so a crash or concurrent
 * build never leaves a half-written, unparseable catalog on disk. A `'route'` request on a project
 * with no App Router directory falls back to `'static'` with a warning rather than failing the build.
 */
export function writeCatalog(
  cwd: string,
  catalog: AiCatalog,
  options: WriteCatalogOptions = {},
): WriteCatalogResult {
  const result = validateCatalogArd(catalog);
  if (!result.valid) {
    return { ok: false, errors: formatCatalogErrors(result.errors) };
  }

  const target = options.target ?? 'static';
  const warn = options.warn ?? (() => {});

  if (target === 'route') {
    const appDir = findAppDir(cwd);
    if (appDir) {
      const path = writeRouteHandler(cwd, appDir, CATALOG_ROUTE_SEGMENTS, jsonText(catalog), {
        contentType: 'application/json',
        served: '/.well-known/ai-catalog.json',
      });
      return { ok: true, path, target: 'route' };
    }
    warn(
      "emit: 'route' was requested but no App Router directory (app/ or src/app/) was found — " +
        'falling back to the static public/.well-known/ai-catalog.json target.',
    );
  }

  return { ok: true, path: writeStaticFile(cwd, catalog), target: 'static' };
}

export type WriteServerCardResult = { path: string; target: EmissionTarget };

/**
 * Writes the well-known MCP server card — either as the static
 * `public/.well-known/mcp/server-card.json` (default) or as an App Router route handler at
 * `app/.well-known/mcp/server-card.json/route.{ts,js}` serving `application/mcp-server-card+json`
 * (`target: 'route'`). Unlike the catalog there is no strict schema to gate on (the server-card
 * shape isn't standardized yet), so this always writes. Follows the
 * same `emit` target and the same static-vs-route fallback as `writeCatalog`.
 */
export function writeServerCard(
  cwd: string,
  card: McpServerCard,
  options: WriteCatalogOptions = {},
): WriteServerCardResult {
  const target = options.target ?? 'static';
  const warn = options.warn ?? (() => {});
  const body = jsonText(card);

  if (target === 'route') {
    const appDir = findAppDir(cwd);
    if (appDir) {
      return {
        path: writeRouteHandler(cwd, appDir, SERVER_CARD_ROUTE_SEGMENTS, body, {
          contentType: SERVER_CARD_CONTENT_TYPE,
          served: '/.well-known/mcp/server-card.json',
        }),
        target: 'route',
      };
    }
    warn(
      "emit: 'route' was requested but no App Router directory (app/ or src/app/) was found — " +
        'falling back to the static public/.well-known/mcp/server-card.json target.',
    );
  }

  return { path: atomicWrite(join(cwd, SERVER_CARD_OUTPUT_PATH), body), target: 'static' };
}

/** Atomically writes the static `public/.well-known/ai-catalog.json`. */
function writeStaticFile(cwd: string, catalog: AiCatalog): string {
  return atomicWrite(join(cwd, CATALOG_OUTPUT_PATH), jsonText(catalog));
}

/**
 * Atomically writes the machine-readable build report. `target` is `ax.config`'s `report` (or the
 * CLI flag) already resolved to truthy: `true` means the default `.ora/report.json`, a string is a
 * project-root-relative (or absolute) path. There is no schema gate — the report *is* the
 * diagnostic channel, so it must always be writable, even for a run whose catalog failed.
 */
export function writeReport(cwd: string, report: BuildReport, target: true | string): string {
  const relPath = target === true ? REPORT_OUTPUT_PATH : target;
  return atomicWrite(resolve(cwd, relPath), jsonText(report));
}

/**
 * Atomically writes `contents` to `outPath` (write to a temp file, then rename into place) so a
 * crash or concurrent build never leaves a half-written, unparseable file on disk.
 */
function atomicWrite(outPath: string, contents: string): string {
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;

  mkdirSync(dirname(outPath), { recursive: true });
  try {
    writeFileSync(tmpPath, contents, 'utf8');
    renameSync(tmpPath, outPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }

  return outPath;
}

interface RouteHandlerMeta {
  /** `Content-Type` header the handler serves. */
  contentType: string;
  /** The path this handler serves at, for the generated comment. */
  served: string;
}

/**
 * Writes a route-handler emission target under `appDir/<segments>/route.{ts,js}`. The payload is
 * embedded as a `force-static` response so the build materializes it just like a static file, but
 * the file lives in the source tree (survives `basePath`/proxy rewrites the way a `public/` asset
 * can't, and is the seam for future dynamic output). `.ts` vs `.js` mirrors the project (a
 * `tsconfig.json` at the root).
 */
function writeRouteHandler(
  cwd: string,
  appDir: string,
  segments: string[],
  body: string,
  meta: RouteHandlerMeta,
): string {
  const useTypeScript = existsSync(join(cwd, 'tsconfig.json'));
  const routeDir = join(appDir, ...segments);
  const routeFile = join(routeDir, useTypeScript ? 'route.ts' : 'route.js');

  mkdirSync(routeDir, { recursive: true });
  writeFileSync(routeFile, routeHandlerSource(body, meta, useTypeScript), 'utf8');
  return routeFile;
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Renders the route-handler source. The payload is embedded as a *JSON string literal* — we
 * `JSON.stringify` the pretty-printed JSON text again, which produces a safely-escaped JS string
 * (no risk from backticks or `${}` in any field value), then serve it verbatim.
 */
function routeHandlerSource(body: string, meta: RouteHandlerMeta, useTypeScript: boolean): string {
  const bodyLiteral = JSON.stringify(body);
  const signature = useTypeScript ? 'export function GET(): Response {' : 'export function GET() {';
  return `// Generated by ax (route emission target). Do not edit by hand — re-run
// \`ax\` to regenerate. Serves ${meta.served}.
export const dynamic = 'force-static';

const body = ${bodyLiteral};

${signature}
  return new Response(body, {
    headers: { 'Content-Type': '${meta.contentType}; charset=utf-8' },
  });
}
`;
}
