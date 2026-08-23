// Tier-2 twin derivation: a prerendered route's final HTML → markdown. Every step is a refusal to
// publish a lie rather than a best effort:
//   - Only the page's content region converts (`<main>`, else `<article>`). Extracting `<body>`
//     would drag nav/footer chrome into the twin, so a page with neither landmark is skipped.
//   - A region with almost no text is a JS shell; its twin would be an empty page presented as the
//     page's content, so under 200 chars of text ax skips (the same line the server-rendered-content
//     audit criterion draws).
//   - Over 100,000 chars the consuming agent's fetch truncates silently, so the twin is refused
//     rather than shipped broken.
//   - An odd count of column-0 code fences means an unclosed fence corrupting everything below it.
//
// Conversion is turndown (+ its GFM plugin for tables/strikethrough), loaded lazily so the
// dependency never loads on runs with no prerendered HTML to convert (ax init's detection pass,
// most unit tests). Parsing uses domino — the same DOM turndown itself uses in Node.

import { fenceMarkerCount } from './markdown-artifact.js';

/** Minimum characters of extracted text for a twin to be honest content, not a shell. */
export const MIN_TWIN_TEXT_CHARS = 200;

/** Ceiling matching the fetch-truncation limit (see artifact-size.ts). */
export const MAX_TWIN_CHARS = 100_000;

export type HtmlTwinSkipReason =
  'no-content-region' | 'too-little-text' | 'too-large' | 'uneven-fences';

export type HtmlTwinResult =
  | {
      ok: true;
      markdown: string;
      /** The document `<title>`, else its first H1's text, if either exists. */
      title?: string;
      /** The document's meta description, when declared. */
      description?: string;
    }
  | {
      ok: false;
      reason: HtmlTwinSkipReason;
      /**
       * The document's resolved head metadata, carried even on a refusal: a page with no
       * server-rendered *content* may still own real metadata, which the metadata twin rung (see
       * markdown-twins.ts) can honestly derive a minimal twin from.
       */
      title?: string;
      description?: string;
    };

/** Elements that never belong in a content twin, removed from the region before conversion. */
const NON_CONTENT_SELECTOR = 'script, style, noscript, template, nav, svg';

/**
 * Converts a prerendered page's HTML into twin markdown, or refuses with the reason a report can
 * carry. Async because the converter dependency is imported lazily.
 */
export async function deriveHtmlTwin(html: string): Promise<HtmlTwinResult> {
  const { createDocument } = await import('@mixmark-io/domino');
  const document = createDocument(html);

  // Resolved head metadata, extracted up front so refusals carry it too (the metadata twin rung
  // reads it off failed derivations).
  const title =
    document.querySelector('title')?.textContent?.trim() ||
    document.querySelector('h1')?.textContent?.trim() ||
    undefined;
  const description =
    document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
    undefined;
  const head = {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
  };

  // domino returns undefined (not the DOM-spec null) on a query miss, so test loosely.
  const region = document.querySelector('main') ?? document.querySelector('article');
  if (region == null) return { ok: false, reason: 'no-content-region', ...head };

  const junk = region.querySelectorAll(NON_CONTENT_SELECTOR);
  for (let i = junk.length - 1; i >= 0; i--) junk[i]?.remove();

  const text = (region.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < MIN_TWIN_TEXT_CHARS) return { ok: false, reason: 'too-little-text', ...head };

  const { default: TurndownService } = await import('turndown');
  const { gfm } = await import('turndown-plugin-gfm');
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  service.use(gfm);

  const markdown = `${service.turndown(region.innerHTML).trim()}\n`;
  if (markdown.length > MAX_TWIN_CHARS) return { ok: false, reason: 'too-large', ...head };
  if (fenceMarkerCount(markdown) % 2 !== 0) return { ok: false, reason: 'uneven-fences', ...head };

  return { ok: true, markdown, ...head };
}
