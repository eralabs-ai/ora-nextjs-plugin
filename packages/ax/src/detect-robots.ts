import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';
import { scaffoldRobots, type RobotsScaffoldResult } from './scaffold-robots.js';

export interface DetectRobotsOptions {
  cwd: string;
  /** Emits an advisory recommendation (not a warning — nothing is wrong). */
  recommend: (message: string) => void;
  /**
   * `ax.config` `scaffoldRobots`, resolved. Opt-in — defaults to `false`. When on, ax appends the
   * discovery pointers it can derive to an existing `public/robots.txt`, or writes one when the
   * project has no robots source at all. See scaffold-robots.ts for what it will and won't touch.
   */
  scaffold?: boolean;
  /** Resolved site origin — the `Sitemap:`/`Agentmap:` pointers must be absolute URLs. */
  siteUrl?: string;
  /** `next.config` `basePath`, or `''`. */
  basePath?: string;
  /** Whether a sitemap actually exists this run. No `Sitemap:` line is written for one that doesn't. */
  sitemapFound?: boolean;
  /** Non-fatal notices from the scaffold write. Optional so the detector can run standalone. */
  warn?: (message: string) => void;
}

export interface DetectRobotsResult {
  /** Whether a robots source (static file or App Router `robots.*`) was found. */
  found: boolean;
  /** The detected source path, if any. */
  source?: string;
  /** Outcome of the opt-in scaffold/append, when `scaffold` was on. */
  scaffold?: RobotsScaffoldResult;
}

const ROBOTS_ROUTE_NAMES = new Set(['robots.ts', 'robots.js', 'robots.tsx', 'robots.jsx']);

/**
 * Detect-and-recommend for `robots.txt`, which controls whether AI crawlers and agents are allowed
 * to reach a site at all. The plugin never rewrites a site's robots policy — unblocking crawlers on
 * the owner's behalf is theirs to decide — it only **detects** an existing `public/robots.txt` or App
 * Router `robots.{ts,js}` and **recommends** an agent-friendly policy.
 *
 * The recommendation is deliberately scoped to specific user-agents, never `User-agent: *`. The exact
 * user-agent tokens individual AI crawlers send vary and change over time, so the advice names the
 * shape of the rule rather than a guessed token — precision over recall applied to our own advice.
 */
export function detectRobots(options: DetectRobotsOptions): DetectRobotsResult {
  const source = findRobotsSource(options.cwd);

  if (options.scaffold === true) {
    return manageScaffold(options, source);
  }

  if (source) {
    options.recommend(detectedRecommendation(relativeSource(options.cwd, source)));
    return { found: true, source };
  }

  options.recommend(
    'No robots.txt found — add one (app/robots.ts or public/robots.txt) that explicitly Allows the ' +
      'reputable AI agents you want to reach, scoped to specific User-agent groups (never ' +
      '"User-agent: *"), plus a "Sitemap:" line. Note: Next\'s MetadataRoute.Robots (app/robots.ts) ' +
      'has no field for the "Agentmap:" catalog pointer — put that line in a static public/robots.txt. ' +
      'Set scaffoldRobots: true in ax.config to have one written for you.',
  );
  return { found: false };
}

/**
 * The `scaffoldRobots: true` path: hand off to the write module, then say only what's still true.
 * A file ax just created or appended the pointers to doesn't need a recommendation to add them —
 * the scaffold's own warning already reports what it wrote — so the advisory narrows to the part
 * ax can't decide, which is which agents the site wants to allow.
 */
function manageScaffold(
  options: DetectRobotsOptions,
  source: string | undefined,
): DetectRobotsResult {
  const scaffold = scaffoldRobots({
    cwd: options.cwd,
    basePath: options.basePath ?? '',
    sitemapFound: options.sitemapFound ?? false,
    warn: options.warn ?? (() => {}),
    ...(source !== undefined ? { existingSource: source } : {}),
    ...(options.siteUrl !== undefined ? { siteUrl: options.siteUrl } : {}),
  });

  // A `public/robots.txt` written during this postbuild ships with the deploy exactly like the
  // catalog next to it, so it counts as found from here on.
  const found = source !== undefined || scaffold.action === 'created';
  const resolvedSource = source ?? (scaffold.action === 'created' ? scaffold.path : undefined);

  if (found && scaffold.action !== 'created') {
    const pointersHandled = scaffold.action === 'appended' || scaffold.action === 'unchanged';
    options.recommend(
      detectedRecommendation(relativeSource(options.cwd, resolvedSource ?? ''), pointersHandled),
    );
  }

  return {
    found,
    ...(resolvedSource !== undefined ? { source: resolvedSource } : {}),
    scaffold,
  };
}

/**
 * The advisory for a site that already has a robots source. `pointersHandled` drops the
 * sitemap/catalog clause: when ax has just confirmed (or written) those lines itself, repeating the
 * advice would send a coding agent looking for work that's already done.
 */
function detectedRecommendation(source: string, pointersHandled = false): string {
  const base =
    `robots.txt detected (${source}) — confirm it explicitly Allows the AI agents you want to ` +
    'reach (scoped to specific User-agent groups, never "User-agent: *")';
  return pointersHandled
    ? `${base}.`
    : `${base}, and that it references your sitemap ("Sitemap:") and catalog ("Agentmap:").`;
}

/** Finds a static `public/robots.txt` or an App Router `robots.{ts,js,tsx,jsx}`, in that order. */
function findRobotsSource(cwd: string): string | undefined {
  const staticFile = join(cwd, 'public', 'robots.txt');
  if (existsSync(staticFile)) return staticFile;

  const appDir = findAppDir(cwd);
  if (!appDir) return undefined;
  let names: string[];
  try {
    names = readdirSync(appDir);
  } catch {
    return undefined;
  }
  const match = names.find((name) => ROBOTS_ROUTE_NAMES.has(name));
  return match ? join(appDir, match) : undefined;
}

function relativeSource(cwd: string, source: string): string {
  return source.startsWith(cwd) ? source.slice(cwd.length).replace(/^[/\\]/, '') : source;
}
