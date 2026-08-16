// The two response headers every *negotiated* markdown response has to carry. A negotiated response
// is one whose body varies by who asked — an agent gets markdown at a URL a browser gets HTML at, or
// a `.md` twin standing in for an HTML page. Both headers exist because markdown, unlike HTML, has no
// in-body place to declare either fact, so the HTTP layer is the only place to declare them.
//
// This is Web-API-only (a standard `Headers` object, no Node built-ins) so the same helper works in
// an Edge middleware, a Node route handler, and a scaffolded server — wherever ax negotiates or
// scaffolds a markdown response.
//
// Scope: `llms.txt` is deliberately *not* a caller. It is a fixed-path artifact served as
// `text/plain`, not a content-negotiated variant of some other page, so it needs neither header.

export interface MarkdownHeaderOptions {
  /**
   * The canonical (HTML) URL this markdown response represents. When given, a
   * `Link: <url>; rel="canonical"` header is added unless one is already present — markdown has no
   * `<link rel="canonical">`, so this header is the only way to tell a crawler the twin and the page
   * are the same resource, and that citations belong to the canonical URL.
   */
  canonicalUrl?: string | URL;
}

/** The `Link` header value declaring a markdown response's canonical URL (RFC 8288 §3). */
export function canonicalLinkHeader(canonicalUrl: string | URL): string {
  return `<${canonicalUrl}>; rel="canonical"`;
}

/**
 * Applies both markdown-response invariants to `headers`, mutating it in place and returning it.
 *
 * 1. `Vary: Accept` — added with **token-level** dedup, never a substring test. A shared cache keys
 *    a response on the header fields named in `Vary` (RFC 9110 §12.5.5); without `Accept` in that
 *    list a CDN serves one client's variant to the next — cached markdown handed to a browser, or
 *    HTML to an agent. Existing `Vary` tokens are split on commas and compared case-insensitively so
 *    a present `Accept-Encoding` is never mistaken for `Accept`, and a `Vary: *` (which already
 *    varies on everything) is left untouched.
 * 2. `Link: <canonicalUrl>; rel="canonical"` — added only when no canonical Link is already present,
 *    so a caller that set its own is never doubled. Presence is tested against the whole existing
 *    `Link` header, which may carry several comma-separated links (RFC 8288 §3).
 */
export function applyMarkdownHeaders(headers: Headers, options?: MarkdownHeaderOptions): Headers {
  if (!varyAlreadyCoversAccept(headers.get('vary'))) {
    headers.append('vary', 'Accept');
  }

  if (options?.canonicalUrl && !hasCanonicalLink(headers.get('link'))) {
    headers.append('link', canonicalLinkHeader(options.canonicalUrl));
  }

  return headers;
}

/** Whether an existing `Vary` value already varies on `Accept` (as a whole token, or via `*`). */
function varyAlreadyCoversAccept(vary: string | null): boolean {
  if (!vary) return false;
  return vary
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .some((token) => token === 'accept' || token === '*');
}

/** Whether an existing `Link` header already declares a `rel=canonical` link (quoted or bare). */
function hasCanonicalLink(link: string | null): boolean {
  if (link === null) return false;
  // Test only the link *parameters*, not the target URIs: a URL that happens to contain the literal
  // "rel=canonical" (e.g. in a query string) must not be read as an existing canonical declaration.
  // `rel` may list several space-separated types, so match `canonical` anywhere inside a quoted value.
  const params = link.replace(/<[^>]*>/g, '');
  return /\brel\s*=\s*("[^"]*\bcanonical\b[^"]*"|'[^']*\bcanonical\b[^']*'|canonical\b)/i.test(
    params,
  );
}
