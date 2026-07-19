import { loadArdConfig } from './config.js';
import { isPathDenied } from './denylist.js';
import { detectLlmsTxt } from './detect-llms-txt.js';
import { detectMcpServers } from './detect-mcp.js';
import { detectOpenApi } from './detect-openapi.js';
import { applyEntryOverrides, entryUrlPath } from './entries.js';
import { loadNextConfig } from './next-config.js';
import { SPEC_VERSION } from './schema.js';
import { readSiteMetadata } from './site-metadata.js';
import { hostnameFromUrl, resolveSiteUrl } from './site-url.js';
import type { AiCatalog, CatalogEntry } from './types.js';

export interface GenerateCatalogOptions {
  /** Project root to read `package.json` / `next.config.*` / `ard.config.*` from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Called with non-fatal build-time notices (next.config fallback, denylist drops, ...). */
  onWarning?: (message: string) => void;
}

/**
 * Builds the catalog: site-level `host` metadata, zero-config artifact detection (PLAN.md 2.2 —
 * MCP servers, `public/openapi.json`, `llms.txt`), plus config-declared entries
 * (overrides/extends — PLAN.md 2.1), all filtered through the denylist/allowlist.
 *
 * Loading `ard.config.*` can throw `ArdConfigError` (invalid config — fails loudly, by design);
 * loading `next.config.*` never throws (warns and falls back instead). Every detector is
 * best-effort and warns rather than throws: a detection miss is never this plugin's reason to fail
 * someone else's build.
 */
export async function generateCatalog(options: GenerateCatalogOptions = {}): Promise<AiCatalog> {
  const cwd = options.cwd ?? process.cwd();
  const warn = options.onWarning ?? (() => {});
  const site = readSiteMetadata(cwd);

  const { config } = await loadArdConfig(cwd);

  const nextConfig = await loadNextConfig(cwd);
  for (const warning of nextConfig.warnings) warn(warning);
  const basePath = nextConfig.config.basePath ?? '';
  if (basePath) {
    warn(
      `next.config sets basePath "${basePath}" — the static ` +
        'public/.well-known/ai-catalog.json will only be served under that prefix, not at the ' +
        'domain root crawlers expect (a basePath-aware route-handler emission target is planned ' +
        'for Phase 2.4).',
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

  const domain = config.siteUrl ? hostnameFromUrl(config.siteUrl) : site.domain;

  // No `host.description`: the official ARD schema closes the host object
  // (`additionalProperties: false` — only displayName/identifier/documentationUrl/logoUrl/
  // trustManifest), so a description there would fail the emission gate and the official
  // conformance tool. package.json's description still informs nothing for now; if the spec adds a
  // host description field, re-add it here.
  return {
    specVersion: SPEC_VERSION,
    host: {
      displayName: site.displayName,
      ...(domain !== undefined ? { identifier: `did:web:${domain}` } : {}),
    },
    entries,
  };
}
