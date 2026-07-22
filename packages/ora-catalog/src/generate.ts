import { loadArdConfig } from './config.js';
import { isPathDenied } from './denylist.js';
import { detectAgentsMd } from './detect-agents-md.js';
import { detectLlmsTxt } from './detect-llms-txt.js';
import { detectMcpServers } from './detect-mcp.js';
import { detectOpenApi } from './detect-openapi.js';
import { detectRobots } from './detect-robots.js';
import { detectSitemap } from './detect-sitemap.js';
import { buildDiscoveryRecommendations } from './discovery.js';
import { applyEntryOverrides, entryUrlPath } from './entries.js';
import { loadNextConfig } from './next-config.js';
import { SPEC_VERSION } from './schema.js';
import { readSiteMetadata } from './site-metadata.js';
import { hostnameFromUrl, resolveSiteUrl } from './site-url.js';
import type { AiCatalog, CatalogEntry } from './types.js';
import type { EmissionTarget } from './write.js';

export interface GenerateCatalogOptions {
  /** Project root to read `package.json` / `next.config.*` / `ard.config.*` from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Called with non-fatal build-time notices (next.config fallback, denylist drops, ...). */
  onWarning?: (message: string) => void;
  /**
   * Called with advisory agent-readiness recommendations (detect-and-recommend:
   * robots.txt / sitemap.xml / agents.md, plus the ARD §6.1 discovery pointer). Distinct from
   * `onWarning` — nothing is wrong, these are improvements a site can opt into.
   */
  onRecommendation?: (message: string) => void;
}

export interface GenerateCatalogResult {
  catalog: AiCatalog;
  /** Emission target resolved from `ard.config` `emit` — which output `writeCatalog` should write. */
  emit: EmissionTarget;
}

/**
 * Builds the catalog: site-level `host` metadata, zero-config artifact detection (MCP servers,
 * `public/openapi.json`, `llms.txt`), plus config-declared entries (overrides/extends), all
 * filtered through the denylist/allowlist.
 *
 * Loading `ard.config.*` can throw `ArdConfigError` (invalid config — fails loudly, by design);
 * loading `next.config.*` never throws (warns and falls back instead). Every detector is
 * best-effort and warns rather than throws: a detection miss is never this plugin's reason to fail
 * someone else's build.
 */
export async function generateCatalog(
  options: GenerateCatalogOptions = {},
): Promise<GenerateCatalogResult> {
  const cwd = options.cwd ?? process.cwd();
  const warn = options.onWarning ?? (() => {});
  const recommend = options.onRecommendation ?? (() => {});
  const site = readSiteMetadata(cwd);

  const { config } = await loadArdConfig(cwd);

  const nextConfig = await loadNextConfig(cwd);
  for (const warning of nextConfig.warnings) warn(warning);
  const basePath = nextConfig.config.basePath ?? '';
  if (basePath) {
    warn(
      `next.config sets basePath "${basePath}" — the catalog is served under that prefix, not at ` +
        'the domain root crawlers probe. See the discovery-pointer recommendation below (ARD §6.1).',
    );
  }

  // `siteUrl` wins over the Vercel-detected domain — an explicit developer declaration, and the
  // only option on non-Vercel hosts. Every detector below skips emitting a URL-bearing entry
  // (warning instead) when this is undefined, rather than emit a relative URL the spec's schema
  // (`format: uri`) would reject.
  const siteUrl = resolveSiteUrl({ configSiteUrl: config.siteUrl, detectedDomain: site.domain });

  const inferredEntries: CatalogEntry[] = [...detectMcpServers({ cwd, siteUrl, basePath, warn })];

  const openApiEntry = detectOpenApi({ cwd, siteUrl, basePath, warn });
  if (openApiEntry) inferredEntries.push(openApiEntry);

  const llmsTxtResult = detectLlmsTxt({
    cwd,
    siteUrl,
    basePath,
    warn,
    scaffold: config.scaffoldLlmsTxt,
  });
  if (llmsTxtResult.entry) inferredEntries.push(llmsTxtResult.entry);

  // Declaring entries in config is expected, not noteworthy — the per-entry notes
  // (`applyEntryOverrides().notes`) are left for the Phase 2.3 build summary rather than surfaced
  // as warnings here. A denylist *exclusion*, below, is worth warning about: an inferred or
  // config-declared entry that then got dropped.
  const { entries: overridden } = applyEntryOverrides(inferredEntries, config.entries);

  const entries = overridden.filter((entry) => {
    const path = entryUrlPath(entry);
    if (path === undefined) return true;
    if (isPathDenied(path, config.denylist, config.allowlist)) {
      warn(`denylist excluded entry "${entry.identifier}" (${path})`);
      return false;
    }
    return true;
  });

  // Detect-and-recommend for the discovery/access artifacts Ora scores. These never
  // add catalog entries and never fail a build — they only surface advisory recommendations. The
  // plugin detects; it never reimplements a sitemap or rewrites a robots policy, and never guesses
  // agents.md content (the companion skill authors that — Phase 6).
  detectRobots({ cwd, recommend });
  detectSitemap({ cwd, recommend });
  detectAgentsMd({ cwd, recommend });
  for (const message of buildDiscoveryRecommendations({ siteUrl, basePath })) recommend(message);

  const domain = config.siteUrl ? hostnameFromUrl(config.siteUrl) : site.domain;

  // No `host.description`: the official ARD schema closes the host object
  // (`additionalProperties: false` — only displayName/identifier/documentationUrl/logoUrl/
  // trustManifest), so a description there would fail the emission gate and the official
  // conformance tool. package.json's description still informs nothing for now; if the spec adds a
  // host description field, re-add it here.
  const catalog: AiCatalog = {
    specVersion: SPEC_VERSION,
    host: {
      displayName: site.displayName,
      ...(domain !== undefined ? { identifier: `did:web:${domain}` } : {}),
    },
    entries,
  };

  return { catalog, emit: config.emit };
}
