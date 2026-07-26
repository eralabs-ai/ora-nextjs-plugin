import { buildArtifactUrl } from './site-url.js';

/**
 * ARD §6.1 alternate discovery mechanisms. These are the in-spec fix for a `basePath`
 * finding: when `next.config` sets a `basePath`, the catalog is served under that prefix
 * (e.g. `/app/.well-known/ai-catalog.json`), not at the conventional root path a crawler probes —
 * so the plugin recommends pointing crawlers at where the catalog *actually* lives, via an HTML
 * `<link rel="ai-catalog">` tag and/or a robots.txt `Agentmap:` directive.
 *
 * DNS SRV-style records are also described in §6.1 but are outside a build tool's reach — documented
 * only, never emitted.
 */

/** The path the catalog is actually served at once `basePath` is applied. */
export function catalogServedPath(basePath: string): string {
  const normalized = basePath === '/' ? '' : stripTrailingSlash(basePath);
  return `${normalized}/.well-known/ai-catalog.json`;
}

export interface DiscoveryRecommendationOptions {
  /** Absolute site origin, if known — lets the recommendations use absolute URLs. */
  siteUrl: string | undefined;
  /** `next.config` `basePath` (e.g. `/app`), or `''` when unset. */
  basePath: string;
}

/**
 * Recommendations for making a `basePath`-hosted catalog discoverable. Returns an empty list when
 * there is no `basePath`: without a prefix the catalog already sits at the conventional
 * `/.well-known/ai-catalog.json`, so no pointer is needed and none is suggested (precision over
 * noise). The `href` is absolute when `siteUrl` is known, and the served (prefixed) path otherwise.
 */
export function buildDiscoveryRecommendations(options: DiscoveryRecommendationOptions): string[] {
  const { siteUrl, basePath } = options;
  if (!basePath || basePath === '/') return [];

  const href = siteUrl
    ? buildArtifactUrl(siteUrl, basePath, '/.well-known/ai-catalog.json')
    : catalogServedPath(basePath);

  return [
    `basePath "${basePath}" means the catalog is served at ${catalogServedPath(basePath)}, not at ` +
      'the conventional /.well-known/ai-catalog.json a crawler probes. Point agents at it (ARD §6.1):',
    `  • Add to your root layout <head>: <link rel="ai-catalog" href="${href}" />`,
    `  • Add to robots.txt (app/robots.ts or public/robots.txt): Agentmap: ${href}`,
  ];
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
