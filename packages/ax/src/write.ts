import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { findAppDir } from './app-dir.js';
import type { BuildReport } from './report.js';
import type { McpServerCardPlan } from './server-card.js';
import type { AiCatalog } from './types.js';
import { formatCatalogErrors, validateCatalogArd } from './validate.js';

/** Where the static emission target lands, relative to the project root. */
export const CATALOG_OUTPUT_PATH = join('public', '.well-known', 'ai-catalog.json');

/** Where the static MCP server card lands (the well-known path agent registries probe). */
export const SERVER_CARD_OUTPUT_PATH = join('public', '.well-known', 'mcp', 'server-card.json');

/** Directory of the static per-server named cards, for a host mounting several MCP servers. */
export const SERVER_CARD_DIR_OUTPUT_PATH = join('public', '.well-known', 'mcp', 'server-card');

/** The served URL path of a named per-server card. */
export function namedServerCardUrlPath(serverName: string): string {
  return `/.well-known/mcp/server-card/${serverName}.json`;
}

/** Default path for the opt-in machine-readable build report — build output, never `public/`. */
export const REPORT_OUTPUT_PATH = join('.ax', 'report.json');

/** App Router route segments that serve the catalog for the `'route'` emission target. */
const CATALOG_ROUTE_SEGMENTS = ['.well-known', 'ai-catalog.json'];

/** App Router route segments that serve the MCP server card for the `'route'` emission target. */
const SERVER_CARD_ROUTE_SEGMENTS = ['.well-known', 'mcp', 'server-card.json'];

/** Route/public segments of the per-server named-card directory. */
const SERVER_CARD_DIR_SEGMENTS = ['.well-known', 'mcp', 'server-card'];

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

export interface WriteServerCardsResult {
  /** Where the root (primary) card landed. */
  rootPath: string;
  /** Named per-server card writes, in plan order. Empty for a single mount. */
  named: Array<{ serverName: string; path: string }>;
  /** Stale named cards removed — servers the plan no longer describes. */
  removed: string[];
  target: EmissionTarget;
}

/**
 * Writes the well-known MCP server cards — either as static files under `public/.well-known/mcp/`
 * (default) or as App Router route handlers serving `application/mcp-server-card+json`
 * (`target: 'route'`). The primary card lands at the root `server-card.json` path agent registries
 * probe; with several mounts, every card (primary included) also lands at its named
 * `server-card/<server-name>.json` slot, so each server has a persistent card recording its own
 * gating decision. Unlike the catalog there is no strict schema to gate on (the server-card shape
 * isn't standardized yet), so this always writes. Follows the same `emit` target and the same
 * static-vs-route fallback as `writeCatalog`.
 *
 * Named cards for servers the plan no longer describes are removed — the committed card is the
 * persistence layer for a mount's gating decision, so a card outliving its mount would keep
 * advertising (and "reviewing") a server that no longer exists.
 */
export function writeServerCards(
  cwd: string,
  plan: McpServerCardPlan,
  options: WriteCatalogOptions = {},
): WriteServerCardsResult {
  const requested = options.target ?? 'static';
  const warn = options.warn ?? (() => {});
  const primary = plan.cards.find((emission) => emission.primary) ?? plan.cards[0];
  if (primary === undefined) throw new Error('writeServerCards: empty card plan');

  const appDir = requested === 'route' ? findAppDir(cwd) : undefined;
  if (requested === 'route' && appDir === undefined) {
    warn(
      "emit: 'route' was requested but no App Router directory (app/ or src/app/) was found — " +
        'falling back to the static public/.well-known/mcp/server-card.json target.',
    );
  }
  const target: EmissionTarget = appDir !== undefined ? 'route' : 'static';

  const writeCard = (segments: string[], served: string, body: string): string =>
    appDir !== undefined
      ? writeRouteHandler(cwd, appDir, segments, body, {
          contentType: SERVER_CARD_CONTENT_TYPE,
          served,
        })
      : atomicWrite(join(cwd, 'public', ...segments), body);

  const rootPath = writeCard(
    SERVER_CARD_ROUTE_SEGMENTS,
    '/.well-known/mcp/server-card.json',
    jsonText(primary.card),
  );

  const named: WriteServerCardsResult['named'] = [];
  if (plan.multi) {
    for (const emission of plan.cards) {
      const fileName = `${emission.serverName}.json`;
      named.push({
        serverName: emission.serverName,
        path: writeCard(
          [...SERVER_CARD_DIR_SEGMENTS, fileName],
          namedServerCardUrlPath(emission.serverName),
          jsonText(emission.card),
        ),
      });
    }
  }

  const keep = new Set(
    plan.multi ? plan.cards.map((emission) => `${emission.serverName}.json`) : [],
  );
  const removed = removeStaleNamedCards(cwd, appDir, keep);

  return { rootPath, named, removed, target };
}

/**
 * Removes named cards (static files and route handlers) whose server is no longer in the plan.
 * Both targets are swept regardless of this run's emission target, so switching `emit` can't leave
 * a stale card behind on the other target.
 */
function removeStaleNamedCards(
  cwd: string,
  appDir: string | undefined,
  keep: Set<string>,
): string[] {
  const removed: string[] = [];

  const staticDir = join(cwd, 'public', ...SERVER_CARD_DIR_SEGMENTS);
  if (existsSync(staticDir)) {
    for (const name of readdirSync(staticDir)) {
      if (!name.endsWith('.json') || keep.has(name)) continue;
      rmSync(join(staticDir, name), { force: true });
      removed.push(join(staticDir, name));
    }
    if (readdirSync(staticDir).length === 0) rmSync(staticDir, { recursive: true, force: true });
  }

  const resolvedAppDir = appDir ?? findAppDir(cwd);
  if (resolvedAppDir === undefined) return removed;
  const routeDir = join(resolvedAppDir, ...SERVER_CARD_DIR_SEGMENTS);
  if (existsSync(routeDir)) {
    for (const name of readdirSync(routeDir)) {
      const handlerDir = join(routeDir, name);
      if (!name.endsWith('.json') || keep.has(name)) continue;
      rmSync(handlerDir, { recursive: true, force: true });
      removed.push(handlerDir);
    }
    if (readdirSync(routeDir).length === 0) rmSync(routeDir, { recursive: true, force: true });
  }

  return removed;
}

/** Atomically writes the static `public/.well-known/ai-catalog.json`. */
function writeStaticFile(cwd: string, catalog: AiCatalog): string {
  return atomicWrite(join(cwd, CATALOG_OUTPUT_PATH), jsonText(catalog));
}

/**
 * Atomically writes the machine-readable build report. `target` is `ax.config`'s `report` (or the
 * CLI flag) already resolved to truthy: `true` means the default `.ax/report.json`, a string is a
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

/**
 * The exact on-the-wire serialization ax writes for JSON artifacts (pretty-printed, trailing
 * newline). Exported so size reporting can measure the *served* body from the in-memory object
 * rather than re-reading a file — which, for the `'route'` target, is a JS wrapper, not this JSON.
 */
export function jsonText(value: unknown): string {
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
