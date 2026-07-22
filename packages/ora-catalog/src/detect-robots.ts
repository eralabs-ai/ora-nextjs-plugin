import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';

export interface DetectRobotsOptions {
  cwd: string;
  /** Emits an advisory recommendation (not a warning — nothing is wrong). */
  recommend: (message: string) => void;
}

export interface DetectRobotsResult {
  /** Whether a robots source (static file or App Router `robots.*`) was found. */
  found: boolean;
  /** The detected source path, if any. */
  source?: string;
}

const ROBOTS_ROUTE_NAMES = new Set(['robots.ts', 'robots.js', 'robots.tsx', 'robots.jsx']);

/**
 * Detect-and-recommend for `robots.txt` (Ora scores it — `robots-ai-policy-quality`,
 * `bot-detection`, `agent-crawler-reachability`). The plugin never rewrites a site's robots policy —
 * unblocking crawlers on the owner's behalf is theirs to decide — it only **detects** an existing
 * `public/robots.txt` or App Router `robots.{ts,js}` and **recommends** an agent-friendly policy.
 *
 * The recommendation is deliberately scoped to specific user-agents, never `User-agent: *`. The exact
 * token Ora's crawler sends is still open, so the advice names the shape of the rule rather than a
 * guessed token — precision over recall applied to our own advice.
 */
export function detectRobots(options: DetectRobotsOptions): DetectRobotsResult {
  const source = findRobotsSource(options.cwd);

  if (source) {
    options.recommend(
      `robots.txt detected (${relativeSource(options.cwd, source)}) — confirm it explicitly Allows ` +
        'the AI agents you want to reach (scoped to specific User-agent groups, never ' +
        '"User-agent: *"), and that it references your sitemap ("Sitemap:") and catalog ("Agentmap:").',
    );
    return { found: true, source };
  }

  options.recommend(
    'No robots.txt found — add one (app/robots.ts or public/robots.txt) that explicitly Allows the ' +
      'reputable AI agents you want to reach, scoped to specific User-agent groups (never ' +
      '"User-agent: *"), plus a "Sitemap:" line. Note: Next\'s MetadataRoute.Robots (app/robots.ts) ' +
      'has no field for the "Agentmap:" catalog pointer — put that line in a static public/robots.txt.',
  );
  return { found: false };
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
