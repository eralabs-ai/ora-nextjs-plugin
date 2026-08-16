import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { manageAgent404 } from './agent-404.js';
import { loadAxConfig } from './config.js';
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
import { resolveGating, type GateTarget } from './gating.js';
import { loadProjectEnv } from './load-project-env.js';
import { buildMarkdownAlternateRecommendation } from './markdown-alternate.js';
import { loadNextConfig } from './next-config.js';
import {
  buildOraChecks,
  ORA_SCAN_API,
  ORA_SKILL_MCP_URL,
  ORA_SKILL_URL,
  type OraArtifact,
} from './ora-checks.js';
import type { BuildReport, ReportArtifact, ReportScaffolds } from './report.js';
import { buildRouterModel } from './router-model.js';
import type { JsonLdScaffoldResult } from './scaffold-json-ld.js';
import { SPEC_VERSION } from './schema.js';
import { buildMcpServerCard, type McpServerCard } from './server-card.js';
import { readSiteMetadata } from './site-metadata.js';
import { hostnameFromUrl, readSiteUrlFromEnv, resolveSiteUrl } from './site-url.js';
import type { AiCatalog, CatalogEntry, EntryAuth } from './types.js';
import type { EmissionTarget } from './write.js';

export interface GenerateCatalogOptions {
  /** Project root to read `package.json` / `next.config.*` / `ax.config.*` from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Called with non-fatal build-time notices (next.config fallback, gated-surface drops, ...). */
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
  /** Emission target resolved from `ax.config` `emit` — which output `writeCatalog` should write. */
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
  /** `ax.config` `report`, resolved: `false` (default), `true` (default path), or a custom path. */
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

/** The `isGated` target kind for an entry, inferred from its media type. */
function gateKindForEntry(entry: CatalogEntry): GateTarget['kind'] {
  if (entry.type === 'application/mcp-server-card+json') return 'mcp';
  if (typeof entry.type === 'string' && entry.type.startsWith('application/vnd.oai.openapi+json')) {
    return 'openapi';
  }
  return 'entry';
}

/**
 * Applies the resolved `isGated` policy to the entry set. Precision over recall, applied to gating:
 *   - An entry ax can describe (a detector attached an `auth` descriptor, or the developer declared
 *     one) is *published with that descriptor* — more discoverable than dropping it. If `isGated`
 *     contradicts a `none` descriptor (the surface declares itself open but config says gated), the
 *     explicit config wins: the descriptor is downgraded to `unknown` and the disagreement warned.
 *   - An entry ax *can't* describe (no descriptor) that `isGated` marks gated is dropped — never
 *     advertised as an open surface. This is the safety net the default floor (`/api/auth/**`,
 *     `/api/webhooks/**`) relies on.
 *   - Everything else is published unchanged. `isGated` is never consulted to assert "open": an
 *     entry it returns `false` for just keeps whatever descriptor it already had (usually none).
 * Entries with no URL path (spec allows `data`-only) have nothing to match, so they pass through.
 */
function applyGating(
  entries: readonly CatalogEntry[],
  isGated: (target: GateTarget) => boolean,
  warn: (message: string) => void,
): CatalogEntry[] {
  const kept: CatalogEntry[] = [];

  for (const entry of entries) {
    const path = entryUrlPath(entry);
    const derived: EntryAuth | undefined = entry.auth;

    if (path === undefined) {
      kept.push(entry);
      continue;
    }

    const target: GateTarget = {
      kind: gateKindForEntry(entry),
      path,
      ...(Array.isArray(entry.capabilities) ? { tools: entry.capabilities as string[] } : {}),
    };
    const gated = isGated(target);

    if (derived !== undefined) {
      if (gated && derived.status === 'none') {
        warn(
          `isGated marks "${entry.identifier}" (${path}) as gated, but its own declaration shows ` +
            'no auth — emitting auth.status "unknown". Declare the scheme (OpenAPI ' +
            'components.securitySchemes) so agents know how to authenticate.',
        );
        kept.push({ ...entry, auth: { status: 'unknown' } });
      } else {
        kept.push(entry);
      }
      continue;
    }

    if (gated) {
      warn(
        `isGated excluded entry "${entry.identifier}" (${path}) — it is gated but ax can't derive ` +
          'an auth descriptor for it, so it is not published as an open surface. Declare it in ' +
          'ax.config "entries" with an "auth" descriptor to list it as gated instead.',
      );
      continue;
    }

    kept.push(entry);
  }

  return kept;
}

/**
 * Next steps for checks a scaffold has *started* but can't finish. Both cases are still `actionable`
 * — a starter nobody has filled in and a component nobody imports publish nothing — but "the file
 * is there, do this one thing" is a very different instruction from "this is missing", and an agent
 * reading the report should get the specific one.
 */
function oraCheckNotes(scaffolds: {
  llmsTxtScaffolded?: string;
  jsonLd?: JsonLdScaffoldResult;
}): Partial<Record<OraArtifact, string>> {
  const notes: Partial<Record<OraArtifact, string>> = {};

  if (scaffolds.llmsTxtScaffolded !== undefined) {
    notes['llms.txt'] =
      `A starter llms.txt was scaffolded at ${scaffolds.llmsTxtScaffolded}. Replace the TODOs in ` +
      'its "When to use" section with real guidance, then rebuild — this build could not reference ' +
      '/llms.txt because nothing served it while it ran.';
  }

  const wiring = scaffolds.jsonLd?.wiring;
  if (wiring !== undefined && scaffolds.jsonLd?.path !== undefined) {
    notes['json-ld'] =
      `An Organization JSON-LD component was scaffolded at ${scaffolds.jsonLd.path} but nothing ` +
      `renders it yet. Add \`${wiring.importLine}\` and \`${wiring.element}\` to ` +
      `${wiring.layoutPath}, and fill in the component's "sameAs" array.`;
  }

  return notes;
}

/**
 * Builds the catalog: site-level `host` metadata, zero-config artifact detection (MCP servers,
 * `public/openapi.json`, `llms.txt`), plus config-declared entries (overrides/extends), all run
 * through the `isGated` policy (auth descriptor or drop — see `applyGating`).
 *
 * Loading `ax.config.*` can throw `AxConfigError` (invalid config — fails loudly, by design);
 * loading `next.config.*` never throws (warns and falls back instead). Every detector is
 * best-effort and warns rather than throws: a detection miss is never this plugin's reason to fail
 * someone else's build.
 */
export async function generateCatalog(
  options: GenerateCatalogOptions = {},
): Promise<GenerateCatalogResult> {
  // Resolve to an absolute path so relative-path lookups inside `loadAxConfig` (which delegates
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
  // siteUrl fallback below and any `ax.config` that reads `process.env` depend on this.
  loadProjectEnv(cwd);

  const site = readSiteMetadata(cwd);

  // Decide the file-lookup strategy once (App Router, Pages Router, or both), then hand the same
  // model to every detector so they all see one route universe — see router-model.ts.
  const router = buildRouterModel(cwd);

  const { config, warnings: configWarnings } = await loadAxConfig(cwd);
  for (const warning of configWarnings) warn(warning);

  const nextConfig = await loadNextConfig(cwd);
  for (const warning of nextConfig.warnings) warn(warning);
  const basePath = nextConfig.config.basePath ?? '';
  if (basePath) {
    warn(
      `next.config sets basePath "${basePath}" — the catalog is served under that prefix, not at ` +
        'the domain root crawlers probe. See the discovery-pointer recommendation below (ARD §6.1).',
    );
  }

  // Resolve the site origin in precedence order: explicit `ax.config` `siteUrl`, then a
  // `SITE_URL` / `NEXT_PUBLIC_SITE_URL` env var (present during a local build, so the full catalog
  // can be generated and checked before deploying), then Vercel's build-time production domain.
  // Every detector below skips emitting a URL-bearing entry (warning instead) when this is
  // undefined, rather than emit a relative URL the spec's schema (`format: uri`) would reject.
  const siteUrl = resolveSiteUrl({
    configSiteUrl: config.siteUrl,
    envSiteUrl: readSiteUrlFromEnv(),
    detectedDomain: site.domain,
  });

  // Scan route handlers for MCP mounts once, then feed the same mounts to both the catalog entry and
  // the well-known server card (agents discover MCP via the card, not the entry — see server-card.ts).
  const mcpMounts = detectMcpMounts({ cwd, warn, router });
  const inferredEntries: CatalogEntry[] = [
    ...buildMcpEntries({ mounts: mcpMounts, siteUrl, basePath, warn }),
  ];
  const serverCard = buildMcpServerCard({ mounts: mcpMounts, siteUrl, basePath, site, recommend });

  const openApiEntry = detectOpenApi({ cwd, siteUrl, basePath, warn, recommend });
  if (openApiEntry) inferredEntries.push(openApiEntry);

  const openApi = openApiArtifact(cwd);

  const llmsTxtResult = detectLlmsTxt({
    cwd,
    siteUrl,
    basePath,
    warn,
    recommend,
    scaffold: config.scaffoldLlmsTxt,
    site,
    router,
    // Only what this build actually found: the starter's "Machine-readable resources" section is a
    // list of live artifacts, so a link to something that doesn't exist would be worse than none.
    resources: { openApi: openApi.found, mcpPathnames: mcpMounts.map((mount) => mount.pathname) },
  });
  if (llmsTxtResult.entry) inferredEntries.push(llmsTxtResult.entry);

  // In-page WebMCP tools (W3C draft). Declarative `<form toolname>` pages become `text/html`
  // entries (the page is a real, addressable artifact); imperative registrations are runtime-only
  // with no spec-defined manifest, so they surface as warnings/recommendations, never invented
  // entries.
  const webMcp = detectWebMcp({ cwd, siteUrl, basePath, warn, recommend, router });
  inferredEntries.push(...webMcp.entries);

  // Declaring entries in config is expected, not noteworthy — the per-entry notes
  // (`applyEntryOverrides().notes`) are meant for a build summary rather than surfaced as warnings
  // here. A gating decision, below, is worth warning about: a gated surface either carries an auth
  // descriptor or is dropped, and both are worth recording in the build output/report.
  const { entries: overridden } = applyEntryOverrides(inferredEntries, config.entries);
  const entries = applyGating(overridden, resolveGating(config.isGated), warn);

  // Detect-and-recommend for the discovery/access artifacts that affect agent-readiness. These
  // never add catalog entries and never fail a build — they only surface advisory recommendations.
  // The plugin detects; it never reimplements a sitemap or rewrites a robots policy, and never
  // guesses agents.md content (the companion skill authors that).
  // Sitemap first: the robots step writes a `Sitemap:` pointer only for a sitemap that actually
  // exists, so it needs that answer before it runs.
  const sitemap = detectSitemap({ cwd, recommend });
  const robots = detectRobots({
    cwd,
    recommend,
    warn,
    scaffold: config.scaffoldRobots,
    siteUrl,
    basePath,
    sitemapFound: sitemap.found,
  });
  const agentsMd = detectAgentsMd({ cwd, recommend });
  const jsonLd = detectJsonLd({
    cwd,
    recommend,
    warn,
    scaffold: config.scaffoldJsonLd,
    site,
    router,
    ...(siteUrl !== undefined ? { siteUrl } : {}),
  });
  for (const message of buildDiscoveryRecommendations({ siteUrl, basePath })) recommend(message);

  // Markdown-twin alternate link. ax does not generate markdown twins yet, and nothing names them,
  // so `twinPaths` is empty today and this adds nothing to a current build — the recommendation
  // lands the moment there is a twin for a `<link rel="alternate">` to point at.
  for (const message of buildMarkdownAlternateRecommendation({
    siteUrl,
    basePath,
    twinPaths: [],
  })) {
    recommend(message);
  }

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
    router,
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

  const scaffolds: ReportScaffolds = {
    ...(llmsTxtResult.scaffoldedPath !== undefined
      ? { llmsTxt: { path: llmsTxtResult.scaffoldedPath } }
      : {}),
    ...(robots.scaffold !== undefined ? { robotsTxt: robots.scaffold } : {}),
    ...(jsonLd.scaffold !== undefined ? { jsonLd: jsonLd.scaffold } : {}),
  };

  const report: BuildReport = {
    generatedAt: new Date().toISOString(),
    ...(siteUrl !== undefined ? { siteUrl } : {}),
    basePath,
    routers: router.routers,
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
      openapi: openApi,
    },
    scaffolds,
    // Filled in by the CLI once artifacts are on disk (it knows the written catalog / server-card
    // paths and can read the scaffolded files back), so the generator leaves it empty.
    sizes: [],
    ora: {
      skillMcp: ORA_SKILL_MCP_URL,
      skillUrl: ORA_SKILL_URL,
      scanApi: { ...ORA_SCAN_API },
      checks: buildOraChecks(
        {
          // The catalog is the one artifact every run produces, so its checks are always addressed.
          'ai-catalog.json': true,
          'llms.txt': llmsTxtResult.found,
          'robots.txt': robots.found,
          sitemap: sitemap.found,
          'agents.md': agentsMd.found,
          'json-ld': jsonLd.found,
          'openapi.json': openApi.found,
          'mcp-server': mcpMounts.length > 0,
          webmcp: webMcp.toolNames.length > 0,
        },
        oraCheckNotes({ llmsTxtScaffolded: llmsTxtResult.scaffoldedPath, jsonLd: jsonLd.scaffold }),
      ),
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
