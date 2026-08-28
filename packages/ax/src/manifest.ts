import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { loadAxConfig } from './config.js';
import { resolveGating, type IsGated } from './gating.js';
import { loadNextConfig } from './next-config.js';
import { buildRouterModel, type RouterModel } from './router-model.js';
import { servedPath } from './site-url.js';
import { pathSegments, ROUTE_FILE_NAMES, walkFiles } from './walk-files.js';
import {
  CATALOG_OUTPUT_PATH,
  SERVER_CARD_DIR_OUTPUT_PATH,
  SERVER_CARD_OUTPUT_PATH,
} from './write.js';

// The serving manifest: a generated data module a consumer's `middleware.ts` imports, so the
// middleware never rewrites blind — a Next.js middleware alone cannot check that a rewrite target
// exists, but the build-time source tree can. It records the route table, which routes have a
// markdown twin (and where), which paths are gated, and where the discovery artifacts live —
// everything basePath-aware, so the middleware compares against real served paths.
//
// Build-ordering: `middleware.ts` is compiled *during* `next build`, but ax runs *post*build — a
// manifest generated postbuild would only reach the middleware on the next build. The manifest is
// derived from the source tree + config alone (no build output), so the fix is the fast
// `ax manifest` subcommand, wired as `prebuild` by `ax init`: fresh manifest, then the build
// compiles it in. The full postbuild run also refreshes an existing module, so unwired projects
// converge with one-build staleness instead of drifting.

/** Base name (sans extension) of the generated manifest data module. */
export const MANIFEST_MODULE_BASE = 'ax-manifest';

/** The data the manifest module exports. Every path is a served (basePath-prefixed) URL path. */
export interface ServingManifestData {
  /** `next.config` `basePath`, or `''` — recorded so the middleware needn't re-derive it. */
  basePath: string;
  /** Every statically addressable page route, served-path form. */
  routes: string[];
  /**
   * Static served-path prefixes under which *dynamic* routes live (`/blog/[slug]` → `/blog`). The
   * middleware must never claim "not found" for a URL under one of these — whether it exists is
   * only knowable at request time, so such misses stay the app's to answer.
   */
  dynamicRoutePrefixes: string[];
  /** Served route path → served markdown-twin path, for every route with a twin on disk. */
  markdownTwins: Record<string, string>;
  /** Served paths (routes and API endpoints) the gating policy marks gated — never rewrite these to markdown, never advertise them as open. */
  gatedPaths: string[];
  /** Where the discovery artifacts actually live; a member is present only when its source exists. */
  artifacts: {
    aiCatalog?: string;
    /** The root card (the primary MCP server's). */
    mcpServerCard?: string;
    /** Named per-server cards, for a host mounting several MCP servers. */
    mcpServerCards?: string[];
    llmsTxt?: string;
    authMd?: string;
    /** The generated 404 wayfinding guide (`/404.md`), when present. */
    notFoundMd?: string;
    openapi?: string;
  };
}

export interface BuildServingManifestOptions {
  cwd: string;
  router: RouterModel;
  /** The resolved gating predicate (`resolveGating(config.isGated)`). */
  isGated: IsGated;
  basePath: string;
}

/**
 * Derives the manifest data from the source tree: the router model for routes, the gating policy
 * for gated paths, and `public/` for which twins/artifacts exist right now. Twins are read off
 * disk (not re-planned) deliberately — the manifest must describe what is actually servable, and
 * at prebuild time that is whatever the previous postbuild run wrote and the repo committed.
 */
export function buildServingManifest(options: BuildServingManifestOptions): ServingManifestData {
  const { cwd, router, basePath } = options;
  const publicDir = join(cwd, 'public');

  const routes = router.listPageRoutes();
  const servedRoutes = routes.map((route) => servedPath(basePath, route));
  const dynamicRoutePrefixes = router
    .listDynamicRoutePrefixes()
    .map((prefix) => servedPath(basePath, prefix));

  // Twin files present in public/ (generated or user-authored), keyed back to the routes they
  // shadow. A stray .md with no corresponding route is served by Next but is nobody's twin.
  const routeSet = new Set(routes);
  const markdownTwins: Record<string, string> = {};
  if (existsSync(publicDir)) {
    for (const file of walkFiles(publicDir, (name) => name.endsWith('.md'))) {
      const base = file.absolutePath.split(sep).pop() ?? '';
      const segments = pathSegments(file.relativeDir);
      const name = base.slice(0, -'.md'.length);
      if (segments.length === 0 && name === 'auth') continue; // the auth guide, not a route twin
      if (segments.length === 0 && name === '404') continue; // the 404 wayfinding guide, not a route twin
      const route =
        name === 'index' && segments.length === 0
          ? '/'
          : `/${[...segments, ...(name === 'index' ? [] : [name])].join('/')}`;
      if (!routeSet.has(route)) continue;
      markdownTwins[servedPath(basePath, route)] = servedPath(
        basePath,
        route === '/' ? '/index.md' : `${route}.md`,
      );
    }
  }

  const gatedPaths = new Set<string>();
  for (const route of routes) {
    const path = servedPath(basePath, route);
    if (options.isGated({ kind: 'page', path })) gatedPaths.add(path);
  }
  for (const endpoint of router.listApiEndpoints()) {
    if (endpoint.url === undefined) continue;
    const path = servedPath(basePath, endpoint.url);
    if (options.isGated({ kind: 'entry', path })) gatedPaths.add(path);
  }

  const artifacts: ServingManifestData['artifacts'] = {};
  const appRouteExists = (...urlSegments: string[]): boolean =>
    router.appDir !== undefined &&
    [...ROUTE_FILE_NAMES].some((name) =>
      existsSync(join(router.appDir as string, ...urlSegments, name)),
    );
  if (
    existsSync(join(cwd, CATALOG_OUTPUT_PATH)) ||
    appRouteExists('.well-known', 'ai-catalog.json')
  ) {
    artifacts.aiCatalog = servedPath(basePath, '/.well-known/ai-catalog.json');
  }
  if (
    existsSync(join(cwd, SERVER_CARD_OUTPUT_PATH)) ||
    appRouteExists('.well-known', 'mcp', 'server-card.json')
  ) {
    artifacts.mcpServerCard = servedPath(basePath, '/.well-known/mcp/server-card.json');
  }
  // Named per-server cards: whichever emission target produced them, the served path is the same.
  const namedCardNames = new Set<string>();
  const staticCardDir = join(cwd, SERVER_CARD_DIR_OUTPUT_PATH);
  if (existsSync(staticCardDir)) {
    for (const name of readdirSync(staticCardDir)) {
      if (name.endsWith('.json')) namedCardNames.add(name);
    }
  }
  const routeCardDir =
    router.appDir !== undefined
      ? join(router.appDir, '.well-known', 'mcp', 'server-card')
      : undefined;
  if (routeCardDir !== undefined && existsSync(routeCardDir)) {
    for (const name of readdirSync(routeCardDir)) {
      if (
        name.endsWith('.json') &&
        [...ROUTE_FILE_NAMES].some((file) => existsSync(join(routeCardDir, name, file)))
      ) {
        namedCardNames.add(name);
      }
    }
  }
  if (namedCardNames.size > 0) {
    artifacts.mcpServerCards = [...namedCardNames]
      .sort()
      .map((name) => servedPath(basePath, `/.well-known/mcp/server-card/${name}`));
  }
  if (existsSync(join(cwd, 'public', 'llms.txt')) || appRouteExists('llms.txt')) {
    artifacts.llmsTxt = servedPath(basePath, '/llms.txt');
  }
  if (existsSync(join(cwd, 'public', 'auth.md'))) {
    artifacts.authMd = servedPath(basePath, '/auth.md');
  }
  if (existsSync(join(cwd, 'public', '404.md'))) {
    artifacts.notFoundMd = servedPath(basePath, '/404.md');
  }
  if (existsSync(join(cwd, 'public', 'openapi.json'))) {
    artifacts.openapi = servedPath(basePath, '/openapi.json');
  }

  return {
    basePath,
    routes: servedRoutes,
    dynamicRoutePrefixes,
    markdownTwins,
    gatedPaths: [...gatedPaths].sort(),
    artifacts,
  };
}

/**
 * Where the manifest module lives: beside `middleware.ts`'s allowed locations — `src/` when the
 * project keeps its router dirs there, else the project root. `.ts` vs `.js` mirrors the project.
 */
export function manifestModulePath(cwd: string, router: RouterModel): string {
  const srcBased = [router.appDir, router.pagesDir].some(
    (dir) => dir !== undefined && dir.startsWith(join(cwd, 'src') + sep),
  );
  const ext = existsSync(join(cwd, 'tsconfig.json')) ? 'ts' : 'js';
  const dir = srcBased ? join(cwd, 'src') : cwd;
  return join(dir, `${MANIFEST_MODULE_BASE}.${ext}`);
}

/** The manifest module already on disk, if any — the refresh-if-present guard. */
export function existingManifestModulePath(cwd: string): string | undefined {
  const srcDir = join(cwd, 'src');
  const candidates = [
    join(cwd, `${MANIFEST_MODULE_BASE}.ts`),
    join(cwd, `${MANIFEST_MODULE_BASE}.js`),
    join(srcDir, `${MANIFEST_MODULE_BASE}.ts`),
    join(srcDir, `${MANIFEST_MODULE_BASE}.js`),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Renders the module source: a marked, regenerated data module (same contract as `emit: 'route'`). */
export function renderManifestModule(data: ServingManifestData, useTypeScript: boolean): string {
  return (
    '// Generated by ax (`ax manifest`, also refreshed by the postbuild `ax` run). Do not edit —\n' +
    '// import it from your middleware so rewrites are checked against routes and markdown twins\n' +
    '// that actually exist, instead of rewriting blind.\n' +
    `export const axManifest = ${JSON.stringify(data, null, 2)}${useTypeScript ? ' as const' : ''};\n`
  );
}

export interface WriteServingManifestResult {
  /** Where the module was written, relative to the project root. */
  path: string;
  data: ServingManifestData;
}

/**
 * Generates and writes the serving manifest for `cwd` — the whole `ax manifest` subcommand. Loads
 * config (an invalid `ax.config` throws `AxConfigError`, same as a build) and next.config, then
 * derives everything else from the source tree. Fast by design: no build output is read, so it can
 * run as `prebuild` without slowing the build down.
 */
export async function writeServingManifest(
  cwd: string,
  warn: (message: string) => void,
): Promise<WriteServingManifestResult> {
  const { config } = await loadAxConfig(cwd);
  const nextConfig = await loadNextConfig(cwd);
  for (const message of nextConfig.warnings) warn(message);

  const router = buildRouterModel(cwd);
  const data = buildServingManifest({
    cwd,
    router,
    isGated: resolveGating(config.isGated),
    basePath: nextConfig.config.basePath ?? '',
  });

  const modulePath = manifestModulePath(cwd, router);
  writeFileSync(modulePath, renderManifestModule(data, modulePath.endsWith('.ts')), 'utf8');
  return { path: relative(cwd, modulePath), data };
}

/**
 * Refreshes the manifest module only when one already exists — the full build run's posture: it
 * keeps a module the project opted into (via `ax manifest` / the wizard's prebuild wiring) fresh,
 * but never introduces a new source-tree file as a silent side effect of a build.
 */
export async function refreshServingManifestIfPresent(
  cwd: string,
  warn: (message: string) => void,
): Promise<WriteServingManifestResult | undefined> {
  if (existingManifestModulePath(cwd) === undefined) return undefined;
  return writeServingManifest(cwd, warn);
}
