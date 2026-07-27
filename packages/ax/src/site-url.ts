// Every zero-config detector needs to turn a path it found on disk (`/openapi.json`,
// `/llms.txt`, an MCP mount) into the *absolute* URL the catalog schema requires (`format: uri`
// rejects relative paths — see spec/ai-catalog.schema.json). This module is the one place that
// decides the site's absolute origin and joins paths onto it, so every detector stays consistent
// about basePath handling and precedence.

/**
 * Shared tail for the "can't build an absolute URL" warning every URL-bearing detector (MCP,
 * OpenAPI, llms.txt) emits when no origin resolved — kept in one place so the guidance can't drift
 * out of sync between detectors. Must be explicit that the value is the *public production* URL
 * (it's written into the catalog's entry URLs, so a localhost/preview value would be wrong), and
 * that "locally" means you can *set* it locally — not that a local URL is acceptable.
 */
export const NO_SITE_URL_HINT =
  "set your site's public production URL — e.g. https://yourdomain.com, NOT a localhost or preview " +
  'URL, since this value is written into the catalog\'s entry URLs — via "siteUrl" in ax.config ' +
  'or a SITE_URL / NEXT_PUBLIC_SITE_URL env var. You can set it locally to generate and preview the ' +
  'real catalog before deploying.';

/** Where the site's absolute origin can come from, in precedence order (config wins). */
export interface ResolveSiteUrlOptions {
  /** `ax.config` `siteUrl` — an explicit developer declaration, so it always wins. */
  configSiteUrl?: string;
  /** Absolute URL from a build-time env var (`SITE_URL` / `NEXT_PUBLIC_SITE_URL`) — see `readSiteUrlFromEnv`. */
  envSiteUrl?: string;
  /** Best-effort domain from `readSiteMetadata` (currently: Vercel's production-domain env var). */
  detectedDomain?: string;
}

/**
 * Resolves the site's absolute origin (no trailing slash), or undefined if none of an explicit
 * `siteUrl`, an env-var URL, or a detected domain is available. Undefined is a normal, expected
 * outcome (e.g. a non-Vercel host with nothing configured) — callers must treat it as "can't build
 * absolute URLs right now", not an error. Precedence: explicit config wins, then the env var (which
 * is present during a local build, unlike Vercel's), then the provider-detected domain.
 */
export function resolveSiteUrl(options: ResolveSiteUrlOptions): string | undefined {
  if (options.configSiteUrl) return stripTrailingSlash(options.configSiteUrl.trim());
  if (options.envSiteUrl) return stripTrailingSlash(options.envSiteUrl.trim());
  if (options.detectedDomain) return `https://${options.detectedDomain}`;
  return undefined;
}

/**
 * The site origin declared via a build-time env var — `SITE_URL` first, then `NEXT_PUBLIC_SITE_URL`
 * (the two names Next.js apps most commonly use for a stable production URL). Unlike Vercel's
 * `VERCEL_PROJECT_PRODUCTION_URL`, these are present during a plain local `next build`, so a
 * developer can generate the full catalog and iterate on it *before* deploying. Expects an absolute
 * `http(s)://` origin (same shape as `ax.config` `siteUrl`). Returns undefined when neither is set
 * (or both are blank).
 */
export function readSiteUrlFromEnv(): string | undefined {
  const value = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  return value && value.trim() !== '' ? value.trim() : undefined;
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
