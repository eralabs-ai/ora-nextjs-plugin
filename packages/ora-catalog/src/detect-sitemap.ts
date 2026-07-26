import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';

export interface DetectSitemapOptions {
  cwd: string;
  /** Emits an advisory recommendation (not a warning — nothing is broken). */
  recommend: (message: string) => void;
}

export interface DetectSitemapResult {
  found: boolean;
  source?: string;
}

const SITEMAP_ROUTE_NAMES = new Set([
  'sitemap.ts',
  'sitemap.js',
  'sitemap.xml.ts',
  'sitemap.xml.js',
]);

/**
 * Detect-and-recommend for `sitemap.xml`, which lets agents and crawlers discover every public
 * route on a site. Generating a sitemap is a solved, idiomatic Next.js concern (`app/sitemap.ts`),
 * so the plugin **never reimplements** it — it only detects an existing one and, when absent, points
 * at the built-in path. Either way it reminds the developer to reference the sitemap from robots.txt
 * (`Sitemap:`).
 */
export function detectSitemap(options: DetectSitemapOptions): DetectSitemapResult {
  const source = findSitemapSource(options.cwd);

  if (source) {
    options.recommend(
      `sitemap detected (${relativeSource(options.cwd, source)}) — make sure robots.txt references ` +
        'it with a "Sitemap:" line, and that it lists all public routes.',
    );
    return { found: true, source };
  }

  options.recommend(
    'No sitemap found — add one so agents can discover all public routes. Use the built-in Next.js ' +
      'path (app/sitemap.ts); ora-catalog never generates a sitemap itself. Then reference it from ' +
      'robots.txt with a "Sitemap:" line.',
  );
  return { found: false };
}

/** Finds an App Router `sitemap.{ts,js}` or a static `public/sitemap.xml`. */
function findSitemapSource(cwd: string): string | undefined {
  const appDir = findAppDir(cwd);
  if (appDir) {
    let names: string[];
    try {
      names = readdirSync(appDir);
    } catch {
      names = [];
    }
    const match = names.find((name) => SITEMAP_ROUTE_NAMES.has(name));
    if (match) return join(appDir, match);
  }

  const staticFile = join(cwd, 'public', 'sitemap.xml');
  if (existsSync(staticFile)) return staticFile;

  return undefined;
}

function relativeSource(cwd: string, source: string): string {
  return source.startsWith(cwd) ? source.slice(cwd.length).replace(/^[/\\]/, '') : source;
}
