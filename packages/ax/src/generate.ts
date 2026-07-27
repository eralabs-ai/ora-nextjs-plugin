import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { manageAgent404 } from './agent-404.js';
import { loadArdConfig } from './config.js';
import { isPathDenied } from './denylist.js';
import { detectAgentsMd } from './detect-agents-md.js';
import { detectJsonLd } from './detect-json-ld.js';
import { detectLlmsTxt } from './detect-llms-txt.js';
import { buildMcpEntries, detectMcpMounts } from './detect-mcp.js';
import { detectOpenApi } from './detect-openapi.js';
import { detectRobots } from './detect-robots.js';
import { detectSitemap } from './detect-sitemap.js';
import { detectWebMcp } from './detect-webmcp.js';
import { buildDiscoveryRecommendations } from './discovery.js';
import { applyEntryOverrides, entryUrlPath } from './entries.js';
import { loadProjectEnv } from './load-project-env.js';
import { loadNextConfig } from './next-config.js';
import type { BuildReport, ReportArtifact } from './report.js';
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
  /**
   * Distinct in-page WebMCP tool names detected (declarative + browser-reachable imperative) — for
   * the CLI's build summary. Empty when the app registers no WebMCP tools.
   */
  webMcpToolNames: string[];
  /**
   * The machine-readable build report — always assembled; whether (and where) the CLI *writes* it
   * is governed by `reportTarget`. The CLI patches in the written catalog/server-card paths before
   * writing, so the file also records where everything landed.
   */
  report: BuildReport;
  /** `ard.config` `report`, resolved: `false` (default), `true` (default path), or a custom path. */
  reportTarget: boolean | string;
}

/** Presence-shape shared by the detect-and-recommend detectors (`{found, source?}`). */
function artifact(result: { found: boolean; source?: string }): ReportArtifact {
  return { found: result.found, ...(result.source !== undefined ? { source: result.source } : {}) };
}

/** Presence of a committed `public/openapi.json` — the one artifact whose detector returns only an entry. */
function openApiArtifact(cwd: string): ReportArtifact {
  const source = join('public', 'openapi.json');
  return existsSync(join(cwd, source)) ? { found: true, source } : { found: false };
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

  // Tee every warning/recommendation into the build report as well as the caller's callbacks, so
  // the report is a faithful machine-readable twin of the CLI output.
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    options.onWarning?.(message);
  };
  const recommend = (message: string): void => {
    recommendations.push(message);
    options.onRecommendation?.(message);
  };

  // Load the project's `.env*` files first: the CLI runs as its own process (a `postbuild` step),
  // so — unlike `next build` — nothing has populated `process.env` from them yet. Both the env-var
  // siteUrl fallback below and any `ard.config` that reads `process.env` depend on this.
  loadProjectEnv(cwd);

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

  // In-page WebMCP tools (W3C draft). Declarative `<form toolname>` pages become `text/html`
  // entries (the page is a real, addressable artifact); imperative registrations are runtime-only
  // with no spec-defined manifest, so they surface as warnings/recommendations, never invented
  // entries.
  const webMcp = detectWebMcp({ cwd, siteUrl, basePath, warn, recommend });
  inferredEntries.push(...webMcp.entries);

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
  const robots = detectRobots({ cwd, recommend });
  const sitemap = detectSitemap({ cwd, recommend });
  const agentsMd = detectAgentsMd({ cwd, recommend });
  const jsonLd = detectJsonLd({ cwd, recommend });
  for (const message of buildDiscoveryRecommendations({ siteUrl, basePath })) recommend(message);

  // Agent-aware 404: detect-and-recommend, or (opted in) scaffold a not-found page whose
  // route-manifest data module is regenerated every build. Runs after the artifact detectors so
  // its discovery links only reference what actually exists.
  const agent404 = manageAgent404({
    cwd,
    scaffold: config.scaffoldAgent404,
    basePath,
    llmsTxtFound: llmsTxtResult.found,
    sitemapFound: sitemap.found,
    warn,
    recommend,
  });

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

  const report: BuildReport = {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(siteUrl !== undefined ? { siteUrl } : {}),
    basePath,
    catalog: {
      entryCount: entries.length,
      entries: entries.map((entry) => ({
        identifier: entry.identifier,
        type: entry.type,
        ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
        ...(typeof entry.displayName === 'string' ? { displayName: entry.displayName } : {}),
      })),
    },
    mcp: {
      mounts: mcpMounts.map((mount) => ({ pathname: mount.pathname, tools: mount.capabilities })),
    },
    webmcp: { toolNames: webMcp.toolNames, sites: webMcp.sites },
    agent404: {
      notFoundPresent: agent404.notFoundPresent,
      agentAware: agent404.agentAware,
      ...(agent404.source !== undefined ? { source: agent404.source } : {}),
    },
    artifacts: {
      robotsTxt: artifact(robots),
      sitemap: artifact(sitemap),
      agentsMd: artifact(agentsMd),
      jsonLd: artifact(jsonLd),
      llmsTxt: {
        found: llmsTxtResult.found,
        ...(llmsTxtResult.source !== undefined ? { source: llmsTxtResult.source } : {}),
      },
      openapi: openApiArtifact(cwd),
    },
    warnings,
    recommendations,
  };

  return {
    catalog,
    emit: config.emit,
    webMcpToolNames: webMcp.toolNames,
    report,
    reportTarget: config.report,
    ...(serverCard ? { serverCard } : {}),
  };
}
