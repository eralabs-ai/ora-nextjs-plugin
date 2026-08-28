import {
  findAppDir,
  listAppApiEndpoints,
  listDynamicRoutePrefixes,
  listStaticPageRoutes,
  resolvePagePathname,
} from './app-dir.js';
import {
  findPagesDir,
  listDynamicPagesRoutePrefixes,
  listPagesApiEndpoints,
  listStaticPagesRoutes,
  resolvePagesPathname,
} from './pages-dir.js';

// The single place that decides how this project's files are looked up. Next.js apps come in three
// shapes — App Router (`app/`), Pages Router (`pages/`), or both at once during a migration — and
// every detector needs the same answer to "which pages exist, what URL is this file, where do MCP
// mounts live". Deciding that per-detector would drift (one merges both routers, another checks
// only `app/`), so it's decided exactly once here and consumed everywhere through this narrow,
// semantic port. The port deliberately does NOT leak `route.ts`/`page.tsx` naming — a caller asks
// for "page routes" or "API endpoints", not for a convention only one router has.
//
// Output artifacts (the catalog, the server card) are static files under `public/` and are
// router-agnostic — a `.well-known` resource is a served file, not a route — so this model is only
// about *reading* topology and about *where scaffolds write their router-specific source*.

export type RouterKind = 'app' | 'pages';

/** A route handler / API endpoint, tagged with the router it came from. */
export interface ApiEndpoint {
  /** Absolute path of the handler file. */
  file: string;
  /** The URL it mounts at, or undefined when a dynamic segment makes it ambiguous. */
  url: string | undefined;
  router: RouterKind;
}

export interface RouterModel {
  cwd: string;
  /** Routers present in the project (`app` listed before `pages`); empty for neither. Which one opt-in scaffolds target is `primary`, below. */
  routers: RouterKind[];
  /** Where opt-in scaffolds write their router-specific source: App Router when present, else Pages. */
  primary?: RouterKind;
  /** The App Router root (`app/` or `src/app/`), when present. */
  appDir?: string;
  /** The Pages Router root (`pages/` or `src/pages/`), when present. */
  pagesDir?: string;
  /** Every statically addressable page route across both routers, deduped and sorted. */
  listPageRoutes(): string[];
  /**
   * The static URL prefix of every dynamic page route across both routers, deduped and sorted
   * (`/blog/[slug]` → `/blog`; a root-level dynamic segment → `/`). Where `listPageRoutes` refuses
   * to guess, this records *where the guessing would be* — so a consumer answering misses (the
   * negotiation middleware's wayfinding) never claims "not found" under a prefix the app may serve.
   */
  listDynamicRoutePrefixes(): string[];
  /**
   * The URL a source file is served at, for attribution of a whole-tree scan (e.g. a WebMCP
   * `<form toolname>` page). Tries the App Router first, then the Pages Router; undefined when the
   * file is neither a statically addressable page.
   */
  resolveUrlForFile(absolutePath: string): string | undefined;
  /** Every route handler / API endpoint across both routers (App `route.*` + `pages/api/**`). */
  listApiEndpoints(): ApiEndpoint[];
}

export interface RouterModelOptions {
  /**
   * `next.config` `pageExtensions`, when the caller has loaded it. Only `md`/`mdx` widen the
   * model: whether an MDX page routes at all is a config decision, so without this the model stays
   * conservative — a `page.mdx` is not counted as a route Next.js may never serve.
   */
  pageExtensions?: readonly string[];
}

/**
 * Builds the project's `RouterModel` once, composing the App and/or Pages adapters based on which
 * router directories exist. `listPageRoutes` unions both routers' routes and lists each URL once —
 * there is no precedence to apply, because Next.js refuses to build an app that defines the same
 * route in both routers ("Conflicting app and page file"), so a buildable app never has a genuine
 * collision; the dedupe is purely defensive. A project with neither router yields empty results from
 * every method — the same silent, never-throwing degradation the individual `findAppDir`-based
 * detectors had.
 */
export function buildRouterModel(cwd: string, options: RouterModelOptions = {}): RouterModel {
  const appDir = findAppDir(cwd);
  const pagesDir = findPagesDir(cwd);
  const mdxExtensions = ['md', 'mdx'].filter(
    (ext) => options.pageExtensions?.includes(ext) ?? false,
  );

  const routers: RouterKind[] = [];
  if (appDir) routers.push('app');
  if (pagesDir) routers.push('pages');
  const primary: RouterKind | undefined = appDir ? 'app' : pagesDir ? 'pages' : undefined;

  return {
    cwd,
    routers,
    ...(primary !== undefined ? { primary } : {}),
    ...(appDir !== undefined ? { appDir } : {}),
    ...(pagesDir !== undefined ? { pagesDir } : {}),

    listPageRoutes() {
      const routes = new Set<string>();
      if (appDir)
        for (const route of listStaticPageRoutes(appDir, mdxExtensions)) routes.add(route);
      if (pagesDir) {
        for (const route of listStaticPagesRoutes(pagesDir, mdxExtensions)) routes.add(route);
      }
      return [...routes].sort();
    },

    listDynamicRoutePrefixes() {
      const prefixes = new Set<string>();
      if (appDir) {
        for (const prefix of listDynamicRoutePrefixes(appDir, mdxExtensions)) prefixes.add(prefix);
      }
      if (pagesDir) {
        for (const prefix of listDynamicPagesRoutePrefixes(pagesDir, mdxExtensions)) {
          prefixes.add(prefix);
        }
      }
      return [...prefixes].sort();
    },

    resolveUrlForFile(absolutePath) {
      if (appDir) {
        const url = resolvePagePathname(absolutePath, appDir, mdxExtensions);
        if (url !== undefined) return url;
      }
      if (pagesDir) {
        const url = resolvePagesPathname(absolutePath, pagesDir, mdxExtensions);
        if (url !== undefined) return url;
      }
      return undefined;
    },

    listApiEndpoints() {
      const endpoints: ApiEndpoint[] = [];
      if (appDir) {
        for (const endpoint of listAppApiEndpoints(appDir)) {
          endpoints.push({ ...endpoint, router: 'app' });
        }
      }
      if (pagesDir) {
        for (const endpoint of listPagesApiEndpoints(pagesDir)) {
          endpoints.push({ ...endpoint, router: 'pages' });
        }
      }
      return endpoints;
    },
  };
}
