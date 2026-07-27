import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';
import {
  JSON_LD_COMPONENT_BASE,
  scaffoldOrganizationJsonLd,
  type JsonLdScaffoldResult,
} from './scaffold-json-ld.js';
import type { SiteMetadata } from './site-metadata.js';
import { walkFiles } from './walk-files.js';

export interface DetectJsonLdOptions {
  cwd: string;
  /** Emits an advisory recommendation (not a warning — nothing is broken). */
  recommend: (message: string) => void;
  /**
   * `ax.config` `scaffoldJsonLd`, resolved. Opt-in — defaults to `false`. When on and no JSON-LD is
   * rendered anywhere, an `Organization` component is written once and the recommendation becomes
   * "here's the exact line to add to your layout" instead of "write a block from scratch".
   */
  scaffold?: boolean;
  /** Resolved site origin, for the scaffolded block's `url`. */
  siteUrl?: string;
  /** `package.json` facts the scaffolded block is built from. Required only when scaffolding. */
  site?: SiteMetadata;
  /** Non-fatal notices from the scaffold write. Optional so the detector can run standalone. */
  warn?: (message: string) => void;
}

export interface DetectJsonLdResult {
  /** Whether a `<script type="application/ld+json">` block was found in a layout/page. */
  found: boolean;
  /** The file the block was found in, if any (relative to `cwd`). */
  source?: string;
  /** Outcome of the opt-in component scaffold, when `scaffold` was on. */
  scaffold?: JsonLdScaffoldResult;
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
 * Detect-and-recommend for JSON-LD structured data, plus (opted in via `scaffoldJsonLd`) a
 * write-once `Organization` component. Text-scans the App Router's `layout`/`page` files for a
 * `<script type="application/ld+json">` block; when present it nudges toward the high-value
 * `Organization` + `sameAs` shape, and when absent it either recommends adding one or scaffolds the
 * component and recommends the one-line edit that publishes it. Never emits a catalog entry and
 * never fails a build.
 */
export function detectJsonLd(options: DetectJsonLdOptions): DetectJsonLdResult {
  const appDir = findAppDir(options.cwd);
  if (!appDir) {
    options.recommend(ABSENT_RECOMMENDATION);
    return { found: false };
  }

  const detected = findRenderedJsonLd(options.cwd, appDir);
  if (detected !== undefined) {
    options.recommend(
      `JSON-LD structured data detected (${detected}) — confirm it includes an Organization block ` +
        'with a "sameAs" array (LinkedIn/GitHub/npm/socials), a logo, and an address, and at least ' +
        'one more @type beyond Organization (SoftwareApplication/Product, or a FAQPage), so ' +
        'registries can disambiguate and rank your site — covering more schema.org types helps ' +
        'them understand it more fully. Make sure you also have an llms.txt: it and JSON-LD ' +
        'reinforce each other (what your site is for vs. what entity it is).',
    );
    return { found: true, source: detected };
  }

  if (options.scaffold !== true || options.site === undefined) {
    options.recommend(ABSENT_RECOMMENDATION);
    return { found: false };
  }

  const scaffold = scaffoldOrganizationJsonLd({
    cwd: options.cwd,
    appDir,
    site: options.site,
    warn: options.warn ?? (() => {}),
    ...(options.siteUrl !== undefined ? { siteUrl: options.siteUrl } : {}),
  });

  if (scaffold.wiring === undefined) {
    // Nothing was written (no app dir, or a write error already warned about) — fall back to the
    // plain nudge so the signal isn't silently dropped.
    options.recommend(ABSENT_RECOMMENDATION);
    return { found: false, scaffold };
  }

  const { importLine, element, layoutPath } = scaffold.wiring;
  const verb = scaffold.action === 'created' ? 'Scaffolded' : 'Already scaffolded:';
  options.recommend(
    `${verb} an Organization JSON-LD component at ` +
      `${relativeSource(options.cwd, scaffold.path ?? '')}, but nothing renders it yet — ax ` +
      `never edits your layout. Add these two lines to ${layoutPath}: \`${importLine}\` at the ` +
      `top, and \`${element}\` inside <body>. Then fill in the component's "sameAs" array ` +
      '(LinkedIn/GitHub/npm/socials) — that array is the entity-disambiguation signal registries ' +
      'rank on, and an empty one earns nothing.',
  );
  return { found: false, scaffold };
}

/**
 * The layout/page file that renders a JSON-LD block, or undefined if none does.
 *
 * Two shapes count. The direct one is the `application/ld+json` marker in a layout or page. The
 * second is a scaffolded `organization-json-ld` component *imported by* a layout or page: the
 * component isn't itself a layout or page, and the layout that imports it never mentions the media
 * type, so neither file alone proves anything — but together they mean the block ships. Without
 * this pair check, correctly wiring up the scaffold would leave the site looking like it still had
 * no structured data.
 */
function findRenderedJsonLd(cwd: string, appDir: string): string | undefined {
  const files = walkFiles(appDir, (name) => LAYOUT_PAGE_FILE_NAMES.has(name));
  const importers: string[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }
    if (content.includes(JSON_LD_MARKER)) return relativeSource(cwd, file.absolutePath);
    if (content.includes(JSON_LD_COMPONENT_BASE)) importers.push(file.absolutePath);
  }

  for (const importer of importers) {
    if (scaffoldedComponentRendersJsonLd(appDir)) return relativeSource(cwd, importer);
  }
  return undefined;
}

/** Whether the scaffolded component file exists and still renders a JSON-LD script tag. */
function scaffoldedComponentRendersJsonLd(appDir: string): boolean {
  for (const extension of ['tsx', 'jsx', 'js']) {
    const path = join(appDir, `${JSON_LD_COMPONENT_BASE}.${extension}`);
    if (!existsSync(path)) continue;
    try {
      return readFileSync(path, 'utf8').includes(JSON_LD_MARKER);
    } catch {
      return false;
    }
  }
  return false;
}

function relativeSource(cwd: string, source: string): string {
  return source.startsWith(cwd) ? source.slice(cwd.length).replace(/^[/\\]/, '') : source;
}
