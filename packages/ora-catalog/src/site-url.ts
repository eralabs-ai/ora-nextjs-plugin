// Every zero-config detector needs to turn a path it found on disk (`/openapi.json`,
// `/llms.txt`, an MCP mount) into the *absolute* URL the catalog schema requires (`format: uri`
// rejects relative paths — see spec/ai-catalog.schema.json). This module is the one place that
// decides the site's absolute origin and joins paths onto it, so every detector stays consistent
// about basePath handling and precedence.

/** Where the site's absolute origin can come from, in precedence order (config wins). */
export interface ResolveSiteUrlOptions {
  /** `ard.config` `siteUrl` — an explicit developer declaration, so it always wins. */
  configSiteUrl?: string;
  /** Best-effort domain from `readSiteMetadata` (currently: Vercel's production-domain env var). */
  detectedDomain?: string;
}

/**
 * Resolves the site's absolute origin (no trailing slash), or undefined if neither an explicit
 * `siteUrl` nor a detected domain is available. Undefined is a normal, expected outcome (e.g. a
 * non-Vercel host with no `siteUrl` configured) — callers must treat it as "can't build absolute
 * URLs right now", not an error.
 */
export function resolveSiteUrl(options: ResolveSiteUrlOptions): string | undefined {
  if (options.configSiteUrl) return stripTrailingSlash(options.configSiteUrl.trim());
  if (options.detectedDomain) return `https://${options.detectedDomain}`;
  return undefined;
}

/**
 * Joins a known-absolute `siteUrl`, an optional `basePath` (from `next.config`, e.g. `/app`), and
 * an absolute `pathname` (e.g. `/openapi.json`) into the single absolute URL a catalog entry's
 * `url` field requires.
 */
export function buildArtifactUrl(siteUrl: string, basePath: string, pathname: string): string {
  const normalizedBasePath = basePath === '/' ? '' : stripTrailingSlash(basePath);
  return `${stripTrailingSlash(siteUrl)}${normalizedBasePath}${pathname}`;
}

/** The hostname of an absolute URL, or undefined if it doesn't parse — never throws. */
export function hostnameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Builds an ARD entry identifier: `urn:air:<publisher>:<segment>...` (spec §4.2.1), where
 * `<publisher>` is the site's domain — the URN's verifiable trust anchor, and the value registries
 * extract as the filterable `publisher` field. The official schema enforces
 * `^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$`, so each segment is sanitized (e.g. an MCP mount
 * pathname `/api/mcp` becomes `api-mcp`); empty segments are dropped. Callers pass a known-absolute
 * `siteUrl` — the same precondition every URL-bearing entry already has.
 */
export function buildUrn(siteUrl: string, ...segments: string[]): string {
  const publisher = new URL(siteUrl).hostname;
  const parts = segments
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter((segment) => segment !== '');
  return `urn:air:${publisher}:${parts.join(':')}`;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
