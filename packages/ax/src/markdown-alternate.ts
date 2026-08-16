import { absoluteOrServedUrl } from './site-url.js';

// The advisory nudge to link an HTML page to its markdown twin, so a crawler that fetches the page
// learns a machine-readable version exists: `<link rel="alternate" type="text/markdown" href="…">`
// in the page's <head>. Like the JSON-LD wiring, ax prints the exact tag rather than editing the
// layout behind the developer's back — inserting an element into every-page-renders-through markup is
// not a change a postbuild step should make silently.
//
// It fires *only once markdown twins exist*. Before there is a twin to point at, the tag would
// reference nothing, so an empty twin set yields no recommendation at all — which keeps this
// invisible to today's builds (ax does not generate twins yet) and correct the moment twins ship.

export interface MarkdownAlternateOptions {
  /** Absolute site origin, if known — lets the example tag use an absolute URL. */
  siteUrl: string | undefined;
  /** `next.config` `basePath` (e.g. `/app`), or `''` when unset. */
  basePath: string;
  /**
   * The markdown-twin URL paths this build produced (from the build's serving manifest, once
   * markdown twins are generated), e.g. `/docs.md`. The recommendation is emitted only when this is
   * non-empty; the first entry seeds the example tag.
   */
  twinPaths: readonly string[];
}

/**
 * Returns the markdown-alternate recommendation lines, or an empty list when no twin exists yet. The
 * `href` is absolute when the site origin resolved and the served (basePath-prefixed) path otherwise
 * — a relative alternate still resolves against the page that carries it.
 */
export function buildMarkdownAlternateRecommendation(options: MarkdownAlternateOptions): string[] {
  const first = options.twinPaths[0];
  if (first === undefined) return [];

  const href = absoluteOrServedUrl(options.siteUrl, options.basePath, first);
  return [
    'Markdown twins exist for your pages — link each HTML page to its twin so crawlers find the ' +
      'machine-readable version. Add this to the page <head> (ax prints the tag; it never edits ' +
      `your layout): <link rel="alternate" type="text/markdown" href="${href}" />`,
  ];
}
