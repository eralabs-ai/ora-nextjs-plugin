import { resolve } from 'node:path';

import { loadArdConfig } from './config.js';
import { isPathDenied } from './denylist.js';
import { detectAgentsMd } from './detect-agents-md.js';
import { detectJsonLd } from './detect-json-ld.js';
import { detectLlmsTxt } from './detect-llms-txt.js';
import { buildMcpEntries, detectMcpMounts } from './detect-mcp.js';
import { detectOpenApi } from './detect-openapi.js';
import { detectRobots } from './detect-robots.js';
import { detectSitemap } from './detect-sitemap.js';
import { buildDiscoveryRecommendations } from './discovery.js';
import { applyEntryOverrides, entryUrlPath } from './entries.js';
import { loadNextConfig } from './next-config.js';
import { SPEC_VERSION } from './schema.js';
import { buildMcpServerCard, type McpServerCard } from './server-card.js';
import { readSiteMetadata } from './site-metadata.js';
import { hostnameFromUrl, readSiteUrlFromEnv, resolveSiteUrl } from './site-url.js';
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
  /**
   * The well-known MCP server card to emit alongside the catalog, or undefined when there's no
   * (single, resolvable) `mcp-handler` mount to describe. Agents discover MCP via this card, not the
   * ARD catalog entry, so it's written to `/.well-known/mcp/server-card.json` by the CLI.
   */
  serverCard?: McpServerCard;
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
  // Resolve to an absolute path so relative-path lookups inside `loadArdConfig` (which delegates
  // to jiti — resolved against this package's location, not the caller's) behave the same as
  // `existsSync`-based checks, which resolve relative paths against `process.cwd()`.
  const cwd = resolve(options.cwd ?? process.cwd());
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

  // Resolve the site origin in precedence order: explicit `ard.config` `siteUrl`, then a
  // `SITE_URL` / `NEXT_PUBLIC_SITE_URL` env var (present during a local build, so the full catalog
  // can be generated and checked before deploying), then Vercel's build-time production domain.
  // Every detector below skips emitting a URL-bearing entry (warning instead) when this is
  // undefined, rather than emit a relative URL the spec's schema (`format: uri`) would reject.
  const siteUrl = resolveSiteUrl({
    configSiteUrl: config.siteUrl,
    envSiteUrl: readSiteUrlFromEnv(),
    detectedDomain: site.domain,
  });

  // Scan `app/` for MCP mounts once, then feed the same mounts to both the catalog entry and the
  // well-known server card (agents discover MCP via the card, not the entry — see server-card.ts).
  const mcpMounts = detectMcpMounts({ cwd, warn });
  const inferredEntries: CatalogEntry[] = [
    ...buildMcpEntries({ mounts: mcpMounts, siteUrl, basePath, warn }),
  ];
  const serverCard = buildMcpServerCard({ mounts: mcpMounts, siteUrl, basePath, site, recommend });

  const openApiEntry = detectOpenApi({ cwd, siteUrl, basePath, warn, recommend });
  if (openApiEntry) inferredEntries.push(openApiEntry);

  const llmsTxtResult = detectLlmsTxt({
    cwd,
    siteUrl,
    basePath,
    warn,
    recommend,
    scaffold: config.scaffoldLlmsTxt,
  });
  if (llmsTxtResult.entry) inferredEntries.push(llmsTxtResult.entry);

  // Declaring entries in config is expected, not noteworthy — the per-entry notes
  // (`applyEntryOverrides().notes`) are meant for a build summary rather than surfaced as warnings
  // here. A denylist *exclusion*, below, is worth warning about: an inferred or config-declared
  // entry that then got dropped.
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

  // Detect-and-recommend for the discovery/access artifacts that affect agent-readiness. These
  // never add catalog entries and never fail a build — they only surface advisory recommendations.
  // The plugin detects; it never reimplements a sitemap or rewrites a robots policy, and never
  // guesses agents.md content (the companion skill authors that).
  detectRobots({ cwd, recommend });
  detectSitemap({ cwd, recommend });
  detectAgentsMd({ cwd, recommend });
  detectJsonLd({ cwd, recommend });
  for (const message of buildDiscoveryRecommendations({ siteUrl, basePath })) recommend(message);

  // Derive the `did:web:` host from the resolved origin so it's consistent whatever the origin's
  // source (config, env var, or Vercel domain), not just when `siteUrl` was set in config.
  const domain = siteUrl ? hostnameFromUrl(siteUrl) : site.domain;

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

  return { catalog, emit: config.emit, ...(serverCard ? { serverCard } : {}) };
}
