import { readFileSync } from 'node:fs';

import { findAppDir } from './app-dir.js';
import { walkFiles } from './walk-files.js';

export interface DetectJsonLdOptions {
  cwd: string;
  /** Emits an advisory recommendation (not a warning — nothing is broken). */
  recommend: (message: string) => void;
}

export interface DetectJsonLdResult {
  /** Whether a `<script type="application/ld+json">` block was found in a layout/page. */
  found: boolean;
  /** The file the block was found in, if any (relative to `cwd`). */
  source?: string;
}

// Structured data (JSON-LD) is how registries and agents disambiguate and rank a site as an entity.
// The valuable fields — `sameAs` (LinkedIn/GitHub/npm/socials — the entity-disambiguation signal),
// address, logo, extra @types — are external/judgment content the companion skill authors, and
// JSON-LD lives in rendered HTML (a `<script type="application/ld+json">` in the layout), not a file
// this plugin emits. So this is deliberately detect-and-recommend only: it never writes or guesses
// the block.
const LAYOUT_PAGE_FILE_NAMES: ReadonlySet<string> = new Set([
  'layout.tsx',
  'layout.jsx',
  'layout.js',
  'layout.ts',
  'page.tsx',
  'page.jsx',
  'page.js',
  'page.ts',
]);

const JSON_LD_MARKER = 'application/ld+json';

const ABSENT_RECOMMENDATION =
  'No JSON-LD structured data found in your layouts/pages — structured data is how registries and ' +
  'agents disambiguate and rank your site. Add an Organization block in your root layout <head> ' +
  '(<script type="application/ld+json">) with a "sameAs" array linking your LinkedIn/GitHub/npm/' +
  'social profiles (the entity-disambiguation signal registries value), and at least one more ' +
  'schema.org @type beyond Organization — SoftwareApplication or Product for an app/API, or a ' +
  'FAQPage — since covering more types helps registries understand your site more fully. ' +
  'JSON-LD pairs with an llms.txt: llms.txt tells agents what your site is for, JSON-LD identifies ' +
  'it as an entity registries can rank — add both, not one alone. ax won’t author the ' +
  'block (the fields are judgment content); the companion skill can help draft it from your repo.';

/**
 * Detect-and-recommend for JSON-LD structured data. Text-scans the App Router's `layout`/`page`
 * files for a `<script type="application/ld+json">` block; when present it nudges toward the
 * high-value `Organization` + `sameAs` shape, and when absent it recommends adding one. Never emits
 * a catalog entry and never fails a build.
 */
export function detectJsonLd(options: DetectJsonLdOptions): DetectJsonLdResult {
  const appDir = findAppDir(options.cwd);
  if (!appDir) {
    options.recommend(ABSENT_RECOMMENDATION);
    return { found: false };
  }

  const files = walkFiles(appDir, (name) => LAYOUT_PAGE_FILE_NAMES.has(name));
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }
    if (content.includes(JSON_LD_MARKER)) {
      const source = relativeSource(options.cwd, file.absolutePath);
      options.recommend(
        `JSON-LD structured data detected (${source}) — confirm it includes an Organization block ` +
          'with a "sameAs" array (LinkedIn/GitHub/npm/socials), a logo, and an address, and at least ' +
          'one more @type beyond Organization (SoftwareApplication/Product, or a FAQPage), so ' +
          'registries can disambiguate and rank your site — covering more schema.org types helps ' +
          'them understand it more fully. Make sure you also have an llms.txt: it and JSON-LD ' +
          'reinforce each other (what your site is for vs. what entity it is).',
      );
      return { found: true, source };
    }
  }

  options.recommend(ABSENT_RECOMMENDATION);
  return { found: false };
}

function relativeSource(cwd: string, source: string): string {
  return source.startsWith(cwd) ? source.slice(cwd.length).replace(/^[/\\]/, '') : source;
}
