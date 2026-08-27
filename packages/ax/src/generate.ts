import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { manageAgent404 } from './agent-404.js';
import { buildAuthMd, type AuthMdPlan } from './auth-md.js';
import { loadAxConfig } from './config.js';
import { detectAgentsMd } from './detect-agents-md.js';
import { detectJsonLd } from './detect-json-ld.js';
import { detectLlmsTxt } from './detect-llms-txt.js';
import { detectAuthMetadata } from './detect-auth-metadata.js';
import { detectAuthProvider } from './detect-auth-provider.js';
import {
  applyDeclaredMountAuth,
  buildMcpEntries,
  detectMcpMounts,
  mcpMountIdentifier,
  type McpMount,
} from './detect-mcp.js';
import { detectOpenApi } from './detect-openapi.js';
import { detectRobots } from './detect-robots.js';
import { detectSitemap } from './detect-sitemap.js';
import { detectWebMcp } from './detect-webmcp.js';
import { buildDiscoveryRecommendations } from './discovery.js';
import { applyEntryOverrides, entryUrlPath, sanitizeOverrideAuth } from './entries.js';
import { defaultIsGated, resolveGating, type GateTarget, type IsGated } from './gating.js';
import { loadProjectEnv } from './load-project-env.js';
import { buildMarkdownAlternateRecommendation } from './markdown-alternate.js';
import { planMarkdownTwins, type MarkdownTwinPlan } from './markdown-twins.js';
import { buildMiddlewareWiringInstruction, detectMiddleware } from './middleware-wiring.js';
import { loadNextConfig } from './next-config.js';
import { buildOraChecks, type OraArtifact } from './ora-checks.js';
import type { BuildReport, ReportArtifact, ReportAuth, ReportScaffolds } from './report.js';
import { buildRouterModel } from './router-model.js';
import type { JsonLdScaffoldResult } from './scaffold-json-ld.js';
import { SPEC_VERSION } from './schema.js';
import { buildMcpServerCardPlan, type McpServerCardPlan } from './server-card.js';
import { allServerCardRecords, readServerCardRecords } from './server-card-record.js';
import { readSiteMetadata } from './site-metadata.js';
import {
  buildArtifactUrl,
  hostnameFromUrl,
  readSiteUrlFromEnv,
  resolveSiteUrl,
  servedPath,
} from './site-url.js';
import type { AiCatalog, CatalogEntry, EntryAuth } from './types.js';
import { type EmissionTarget, namedServerCardUrlPath } from './write.js';

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
   * The well-known MCP server cards to emit alongside the catalog, or undefined when no resolvable
   * `mcp-handler` mount (or no site origin) exists. Agents discover MCP via these cards, not the
   * ARD catalog entries: the CLI writes the primary server's card to
   * `/.well-known/mcp/server-card.json` and, for a multi-server host, every server's card to its
   * named `/.well-known/mcp/server-card/<server-name>.json` slot.
   */
  serverCardPlan?: McpServerCardPlan;
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
  /**
   * The markdown body a scaffolded `llms.txt` serves, when one was written this run. The CLI sizes
   * this rather than the `route.ts` file on disk, so the reported tokens match what an agent fetches.
   */
  scaffoldedLlmsTxtBody?: string;
  /**
   * This build's markdown-twin plan — computed here (pure, so the review gate can show it), applied
   * by the CLI only after the gate, alongside the catalog write.
   */
  twinPlan: MarkdownTwinPlan;
  /** The generated `/auth.md`, when gated surfaces exist. Written by the CLI with the twins. */
  authMdPlan?: AuthMdPlan;
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
 * Resolves each MCP mount's gated status and attaches the auth descriptor it implies. Auth is
 * declared per *server* in the MCP conventions, so this is a whole-mount decision, resolved in
 * precedence order:
 *   1. A developer-supplied `isGated` owns the whole policy (as everywhere else).
 *   2. Otherwise: the built-in floor, a detected `withMcpAuth` wrapper, or the decision a
 *      previously written server card records (`authentication.required`) — the committed cards
 *      (the root one, and each named per-server one) are the persistence layer for the user's
 *      answers from `ax init` or a build's review gate.
 * A gated mount is never dropped: "requires auth" *is* its description, so it's published with
 * `auth.status "unknown"` and its card carries `authentication.required` — more discoverable than
 * hiding it, and the write is what records the decision for the next build.
 *
 * A mount matched by none of the sources is *unreviewed*: advertised as open (the zero-config
 * default) but returned in `unreviewed` so the CLI can ask interactively or warn in CI.
 *
 * The same read-back resolves which mount is *primary* — whose card owns the root well-known path.
 * That is a judgment call ax never guesses silently: the committed root card records the answer;
 * without one, the first public mount is the default and `primaryUnreviewed` tells the CLI to ask
 * interactively (or warn headless) before the write persists it.
 */
function resolveMcpMountGating(options: {
  mounts: McpMount[];
  isGated: IsGated | undefined;
  basePath: string;
  siteUrl: string | undefined;
  cwd: string;
}): {
  mounts: McpMount[];
  unreviewed: string[];
  primaryPathname: string | undefined;
  primaryUnreviewed: boolean;
} {
  const { mounts, isGated, basePath, siteUrl, cwd } = options;
  if (mounts.length === 0) {
    return { mounts, unreviewed: [], primaryPathname: undefined, primaryUnreviewed: false };
  }

  const records = readServerCardRecords(cwd);
  const allRecords = allServerCardRecords(records);
  const unreviewed: string[] = [];
  const mountServerUrl = (mount: McpMount): string | undefined =>
    siteUrl ? buildArtifactUrl(siteUrl, basePath, mount.pathname) : undefined;

  const resolved = mounts.map((mount) => {
    const path = servedPath(basePath, mount.pathname);
    const target: GateTarget = {
      kind: 'mcp',
      path,
      ...(mount.capabilities.length > 0 ? { tools: mount.capabilities } : {}),
    };
    const serverUrl = mountServerUrl(mount);
    const recorded =
      serverUrl !== undefined
        ? allRecords.find((record) => record.serverUrl === serverUrl)
        : undefined;

    let gated: boolean;
    if (isGated !== undefined) {
      gated = isGated(target);
    } else {
      gated = defaultIsGated(target) || mount.auth !== undefined || recorded?.authRequired === true;
      const reviewed = defaultIsGated(target) || mount.auth !== undefined || recorded !== undefined;
      if (!reviewed) unreviewed.push(path);
    }

    return gated && mount.auth === undefined
      ? { ...mount, auth: { status: 'unknown' as const } }
      : mount;
  });

  // A single mount is trivially primary; several mounts take the root card's recorded answer.
  // Without a record, exactly one *public* server is no judgment call either: the root path is
  // the one registries probe blind, so the one server agents can use without credentials is its
  // only sensible owner — picked silently. Only the ambiguous cases (several public servers, or
  // none) fall back to the first candidate AND set `primaryUnreviewed`, so an interactive build
  // asks and a headless one warns.
  const sortedByPath = [...resolved].sort((a, b) =>
    servedPath(basePath, a.pathname).localeCompare(servedPath(basePath, b.pathname)),
  );
  const publicMounts = sortedByPath.filter((mount) => mount.auth === undefined);
  let primaryPathname = resolved[0]?.pathname;
  let primaryUnreviewed = false;
  if (resolved.length > 1) {
    const rootMatch =
      records.root !== undefined
        ? resolved.find((mount) => mountServerUrl(mount) === records.root?.serverUrl)
        : undefined;
    if (rootMatch !== undefined) {
      primaryPathname = rootMatch.pathname;
    } else {
      primaryPathname = (publicMounts[0] ?? sortedByPath[0])?.pathname;
      primaryUnreviewed = publicMounts.length !== 1;
    }
  }

  return { mounts: resolved, unreviewed, primaryPathname, primaryUnreviewed };
}

/**
 * Applies the resolved `isGated` policy to the entry set. Precision over recall, applied to gating:
 *   - An entry ax can describe (a detector attached an `auth` descriptor, or the developer declared
 *     one) is *published with that descriptor* — more discoverable than dropping it. If `isGated`
 *     contradicts a `none` descriptor (the surface declares itself open but config says gated), the
 *     explicit config wins: the descriptor is downgraded to `unknown` and the disagreement warned.
 *   - An entry ax *can't* describe (no descriptor) that `isGated` marks gated is dropped — never
 *     advertised as an open surface. This is the safety net the default floor (`/api/auth/**`,
 *     `/api/webhooks/**`) relies on. MCP entries never reach this branch: a gated mount's status
 *     *is* its description, so `resolveMcpMountGating` attaches `auth.status "unknown"` upstream
 *     and the entry publishes as gated rather than disappearing.
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
 * Builds the report's structured auth section from the final published surface — the same
 * post-gating mounts and entries auth.md reads, so the report and the guide can never disagree.
 * Each gated surface carries its published scheme, whether it was config-declared, and (when
 * there is one) the actionable gap as a `note` an agent can work directly.
 */
function buildReportAuth(options: {
  cwd: string;
  mounts: McpMount[];
  entries: readonly CatalogEntry[];
  basePath: string;
  siteUrl: string | undefined;
  /** Identifiers whose auth came from an ax.config declaration. */
  declaredIds: ReadonlySet<string>;
}): ReportAuth {
  const { cwd, mounts, entries, basePath, siteUrl, declaredIds } = options;
  const surfaces: ReportAuth['gatedSurfaces'] = [];

  const surfaceNote = (auth: EntryAuth): string | undefined => {
    if (auth.status === 'unknown') {
      return (
        'Gated but the scheme is undeclared — declare entries[].auth in ax.config (the ax init ' +
        'wizard collects this) so agents know how to authenticate.'
      );
    }
    if (auth.docsUrl === undefined) {
      return (
        'No docsUrl — declare where a human obtains access (entries[].auth.docsUrl) so an agent ' +
        'can hand the sign-up step to its human.'
      );
    }
    return undefined;
  };

  const push = (path: string, auth: EntryAuth, declared: boolean): void => {
    const note = surfaceNote(auth);
    surfaces.push({
      path,
      status: auth.status,
      declared,
      oauthEndpoints:
        auth.oauth?.authorizationEndpoint !== undefined || auth.oauth?.tokenEndpoint !== undefined,
      ...(auth.docsUrl !== undefined ? { docsUrl: auth.docsUrl } : {}),
      ...(note !== undefined ? { note } : {}),
    });
  };

  const multiple = mounts.length > 1;
  for (const mount of mounts) {
    if (mount.auth === undefined) continue;
    const declared =
      siteUrl !== undefined &&
      declaredIds.has(mcpMountIdentifier(siteUrl, mount.pathname, multiple));
    push(servedPath(basePath, mount.pathname), mount.auth, declared);
  }
  for (const entry of entries) {
    if (entry.type === 'application/mcp-server-card+json') continue; // covered by its mount above
    if (entry.auth === undefined || entry.auth.status === 'none') continue;
    const path = entryUrlPath(entry);
    if (path === undefined) continue;
    push(path, entry.auth, declaredIds.has(entry.identifier));
  }
  surfaces.sort((a, b) => a.path.localeCompare(b.path));

  const provider = detectAuthProvider(cwd);
  return { gatedSurfaces: surfaces, ...(provider !== undefined ? { provider } : {}) };
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
  twinPlan?: MarkdownTwinPlan;
  authMdMissing?: boolean;
  mcpCardMissing?: boolean;
  middlewareWiring?: string;
}): Partial<Record<OraArtifact, string>> {
  const notes: Partial<Record<OraArtifact, string>> = {};

  if (scaffolds.middlewareWiring !== undefined) {
    notes['middleware'] = scaffolds.middlewareWiring;
  }

  if (scaffolds.mcpCardMissing === true) {
    notes['mcp-server-card'] =
      'MCP server mounts were detected but no server card could be written because no site URL ' +
      'is known — set siteUrl in ax.config (or SITE_URL / NEXT_PUBLIC_SITE_URL) and rebuild to ' +
      'publish the card agents probe.';
  }

  const twinPlan = scaffolds.twinPlan;
  if (twinPlan !== undefined) {
    if (!twinPlan.enabled) {
      notes['markdown-twins'] =
        'markdownTwins is disabled in ax.config, so no .md fallbacks are generated. Set it back ' +
        'to true (the default) to address these checks.';
    } else {
      const rootSkip = twinPlan.skips.find((skip) => skip.route === '/');
      notes['markdown-twins'] =
        (rootSkip !== undefined
          ? `No markdown twin could be derived for the homepage (${rootSkip.reason}): ${rootSkip.detail}`
          : 'No markdown twin exists for the homepage — the URL Ora’s markdown-fallback probe fetches.') +
        ' The report’s markdownTwins.skipped section lists every twin-less route with its reason.';
    }
  }

  if (scaffolds.authMdMissing === true) {
    notes['auth.md'] =
      'This site has gated surfaces but markdownTwins is disabled in ax.config, so the generated ' +
      'public/auth.md (how agents obtain access) is not written. Set markdownTwins back to true.';
  }

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

  const { config } = await loadAxConfig(cwd);

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

  // Scan route handlers for MCP mounts once, resolve each mount's gated status (config isGated,
  // the built-in floor, a detected withMcpAuth wrapper, or the decision a previously written
  // server card records), then feed the same resolved mounts to both the catalog entries and the
  // well-known server cards. A gated mount is published everywhere *with* its auth marker — the
  // entry carries auth.status "unknown" and its card carries authentication.required — never
  // dropped: the committed cards are the persistence layer for the gating decisions, so they must
  // exist to record them.
  const gating = resolveGating(config.isGated);

  // Sanitize any config-declared entry `auth` once, up front — both consumers below (the MCP
  // mount routing and the entry-override merge) then see the same clean, secret-free descriptors
  // and dropped fields are warned exactly once.
  const entryOverrides = sanitizeOverrideAuth(config.entries, warn);

  // A declared auth on an MCP server's entry override refines the mount itself (not just the
  // catalog entry): the mount is what the server card and the generated /auth.md read, and a
  // declaration is how the developer supplies the endpoints detection can never derive
  // (withMcpAuth only ever yields status "unknown"). Applied before gating resolves, so a
  // declaration — like a detected wrapper — marks its mount gated and reviewed.
  const detectedMounts = applyDeclaredMountAuth({
    mounts: detectMcpMounts({ cwd, warn, router }),
    overrides: entryOverrides,
    siteUrl,
    warn,
  });
  const {
    mounts: mcpMounts,
    unreviewed: unreviewedMcpMounts,
    primaryPathname,
    primaryUnreviewed,
  } = resolveMcpMountGating({
    mounts: detectedMounts,
    isGated: config.isGated,
    basePath,
    siteUrl,
    cwd,
  });
  const inferredEntries: CatalogEntry[] = [
    ...buildMcpEntries({ mounts: mcpMounts, siteUrl, basePath, warn }),
  ];
  const serverCardPlan = buildMcpServerCardPlan({
    mounts: mcpMounts,
    primaryPathname,
    siteUrl,
    basePath,
    site,
  });

  const openApiEntry = detectOpenApi({ cwd, siteUrl, basePath, warn, recommend });
  if (openApiEntry) inferredEntries.push(openApiEntry);

  const openApi = openApiArtifact(cwd);

  // Plan this build's markdown twins — pure computation, applied by the CLI only after the review
  // gate. Runs before the llms.txt detector so a scaffolded starter can already link the twins and
  // the auth guide this same run writes.
  const twinPlan = await planMarkdownTwins({
    cwd,
    router,
    isGated: gating,
    basePath,
    ...(nextConfig.config.distDir !== undefined ? { distDir: nextConfig.config.distDir } : {}),
    ...(nextConfig.config.pageExtensions !== undefined
      ? { pageExtensions: nextConfig.config.pageExtensions }
      : {}),
    siteUrl,
    enabled: config.markdownTwins,
    warn,
    recommend,
  });

  // Whether a generated /auth.md is (very likely) being written this run — decided from the same
  // pre-gating signals the final `buildAuthMd` reads, because the llms.txt scaffold runs before
  // entry gating resolves. A config-declared gated entry that only materializes later would just
  // mean the one-time starter misses the link; the auth guide itself is still written.
  const authMdLikely =
    config.markdownTwins &&
    (mcpMounts.some((mount) => mount.auth !== undefined) ||
      (openApiEntry?.auth !== undefined && openApiEntry.auth.status !== 'none'));

  const llmsTxtResult = detectLlmsTxt({
    cwd,
    siteUrl,
    basePath,
    warn,
    recommend,
    scaffold: config.scaffoldLlmsTxt,
    site,
    router,
    // Only what this build actually found (or writes this same run — the twins and auth guide land
    // with the catalog): the starter's "Machine-readable resources" section is a list of live
    // artifacts, so a link to something that doesn't exist would be worse than none.
    resources: {
      openApi: openApi.found,
      mcpPathnames: mcpMounts.map((mount) => mount.pathname),
      twinPaths: twinPlan.servedPaths,
      authMd: authMdLikely,
    },
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
  const { entries: overridden } = applyEntryOverrides(inferredEntries, entryOverrides, warn);
  const entries = applyGating(overridden, gating, warn);

  // Reference the server cards from the catalog: an mcp entry's type promises card JSON, and the
  // card — not the raw endpoint — is the discovery document agents read, so when a card is emitted
  // its entry points at it: the primary server's entry at the root well-known path, every other
  // server's at its named per-server slot. Rewritten only *after* gating, which must match on the
  // mount's own served path, never the card's.
  if (serverCardPlan !== undefined && siteUrl !== undefined) {
    for (const emission of serverCardPlan.cards) {
      const cardPath = emission.primary
        ? '/.well-known/mcp/server-card.json'
        : namedServerCardUrlPath(emission.serverName);
      const cardUrl = buildArtifactUrl(siteUrl, basePath, cardPath);
      for (const entry of entries) {
        if (
          entry.type === 'application/mcp-server-card+json' &&
          entry.url === emission.card.serverUrl
        ) {
          entry.url = cardUrl;
        }
      }
    }
  }

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

  // The generated /auth.md (gated-surface guide), from the final published surface: gated MCP
  // mounts plus entries carrying an auth descriptor. Undefined when nothing is gated — an auth
  // guide with nothing to say would itself be noise. Built unconditionally (it's pure and cheap)
  // so the ora checks can distinguish "nothing gated" (auth.md not applicable) from "gated but the
  // feature is off" (actionable); only an enabled run actually writes it.
  const authMdCandidate = buildAuthMd({
    mounts: mcpMounts,
    entries,
    siteUrl,
    basePath,
    siteDisplayName: site.displayName,
  });
  const authMdPlan = config.markdownTwins ? authMdCandidate : undefined;

  // The report's structured auth section — same inputs as auth.md, plus which descriptors were
  // config-declared and which known auth-provider dependency the app carries.
  const authMetadata = detectAuthMetadata({ cwd, router });
  const reportAuth = buildReportAuth({
    cwd,
    mounts: mcpMounts,
    entries,
    basePath,
    siteUrl,
    declaredIds: new Set(
      entryOverrides
        .filter((override) => override.auth !== undefined)
        .map((override) => override.identifier),
    ),
  });
  if (authMdPlan !== undefined) {
    recommend(
      'Gated routes should keep their honest 401/403 status and point agents at the auth guide: ' +
        'add a WWW-Authenticate header and a Link (or body) pointer to ' +
        `${authMdPlan.servedPath} in your gated route handlers. A 200 "this is gated" page is a ` +
        'soft auth wall agents are built to distrust; ax generates the guide but never rewrites ' +
        'your handlers.',
    );
  }

  // Markdown-twin alternate link: fires only once twins exist for the tag to point at.
  for (const message of buildMarkdownAlternateRecommendation({
    siteUrl,
    basePath,
    twinPaths: twinPlan.servedPaths,
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

  // The negotiation middleware: detect-and-recommend only. `middleware.ts` is the user's singleton,
  // so ax never writes or edits it — an unwired project gets the exact wiring lines (also carried
  // as the negotiation checks' note), a wired one gets nothing. No page routes → nothing to
  // negotiate, so no nudge either.
  const middlewareStatus = detectMiddleware(cwd);
  const middlewareWiring =
    router.listPageRoutes().length > 0 && !middlewareStatus.wiredToAx
      ? buildMiddlewareWiringInstruction(cwd, router, middlewareStatus)
      : undefined;
  if (middlewareWiring !== undefined) recommend(middlewareWiring);

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
      unreviewedMounts: unreviewedMcpMounts,
      ...(mcpMounts.length > 1 && primaryPathname !== undefined
        ? { primaryMount: primaryPathname, ...(primaryUnreviewed ? { primaryUnreviewed } : {}) }
        : {}),
    },
    agent404: {
      notFoundPresent: agent404.notFoundPresent,
      agentAware: agent404.agentAware,
      ...(agent404.source !== undefined ? { source: agent404.source } : {}),
    },
    middleware: {
      present: middlewareStatus.present,
      wiredToAx: middlewareStatus.wiredToAx,
      ...(middlewareStatus.source !== undefined ? { source: middlewareStatus.source } : {}),
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
    auth: reportAuth,
    scaffolds,
    // Planned values; the CLI reconciles `written`/`deleted`/`authMd` after it applies the plan
    // (post-review-gate), the same way it patches in the catalog path.
    markdownTwins: {
      enabled: twinPlan.enabled,
      written: twinPlan.writes.map((twin) => ({
        route: twin.route,
        path: relative(cwd, twin.filePath),
        tier: twin.tier,
        source: twin.source,
      })),
      userOwned: twinPlan.userOwned.map((twin) => ({
        route: twin.route,
        source: twin.sourcePath,
      })),
      skipped: twinPlan.skips,
      dynamicRouteCount: twinPlan.dynamicRouteCount,
      deleted: [],
      ...(authMdPlan !== undefined
        ? { authMd: { path: join('public', 'auth.md'), surfaceCount: authMdPlan.surfaceCount } }
        : {}),
    },
    // Filled in by the CLI once artifacts are on disk (it knows the written catalog / server-card
    // paths and can read the scaffolded files back), so the generator leaves it empty.
    sizes: [],
    ora: {
      checks: buildOraChecks(
        {
          // The catalog is the one artifact every run produces, so its checks are always addressed.
          'ai-catalog.json': true,
          'llms.txt': llmsTxtResult.found,
          // Ora's probe fetches the *homepage's* .md fallback, so the root twin is what answers
          // it — a site with no page routes at all has nothing for the probe to fetch (N/A).
          'markdown-twins':
            router.listPageRoutes().length === 0
              ? 'not-applicable'
              : twinPlan.writes.some((twin) => twin.route === '/') ||
                twinPlan.userOwned.some((twin) => twin.route === '/'),
          'robots.txt': robots.found,
          sitemap: sitemap.found,
          'agents.md': agentsMd.found,
          'json-ld': jsonLd.found,
          'openapi.json': openApi.found,
          'mcp-server': mcpMounts.length > 0,
          // The card check is answered by the card, not the mount: addressed only when this run
          // actually has cards to write (mounts + a known site origin), N/A with no mounts at all.
          'mcp-server-card':
            mcpMounts.length === 0 ? 'not-applicable' : serverCardPlan !== undefined,
          // With nothing gated there is nothing an auth guide could say — the checks are omitted,
          // never claimed addressed or held actionable.
          'auth.md': authMdCandidate === undefined ? 'not-applicable' : authMdPlan !== undefined,
          // Addressed once no gated surface ships the undeclared "unknown" scheme.
          'auth-declaration':
            reportAuth.gatedSurfaces.length === 0
              ? 'not-applicable'
              : reportAuth.gatedSurfaces.every((surface) => surface.status !== 'unknown'),
          // Only speaks when a gated surface declares OAuth: addressed once the RFC 9728
          // metadata exists somewhere ax can see it (a wired route, a committed document, or a
          // mount's declared resourceMetadataPath).
          'oauth-metadata': !reportAuth.gatedSurfaces.some((s) => s.status === 'oauth2')
            ? 'not-applicable'
            : authMetadata.resourceMetadataRoute !== undefined ||
              mcpMounts.some((mount) => mount.resourceMetadataPath !== undefined) ||
              authMetadata.issuersSource?.includes('oauth-protected-resource') === true,
          // Negotiation is runtime behavior on page URLs: N/A with no page routes, addressed once
          // a middleware file wires the ax runtime entry.
          middleware:
            router.listPageRoutes().length === 0 ? 'not-applicable' : middlewareStatus.wiredToAx,
        },
        {
          ...oraCheckNotes({
            llmsTxtScaffolded: llmsTxtResult.scaffoldedPath,
            jsonLd: jsonLd.scaffold,
            twinPlan,
            authMdMissing: authMdCandidate !== undefined && authMdPlan === undefined,
            mcpCardMissing: mcpMounts.length > 0 && serverCardPlan === undefined,
            ...(middlewareWiring !== undefined ? { middlewareWiring } : {}),
          }),
          'auth-declaration':
            'A gated surface publishes auth.status "unknown" — declare entries[].auth in ' +
            'ax.config (the ax init wizard collects this) so agents know the scheme.',
          'oauth-metadata':
            'OAuth is declared but no RFC 9728 protected-resource metadata is wired, so agents ' +
            "can't discover the authorization server. Add your provider's protected-resource " +
            'route (see report.auth.provider) or a static /.well-known/oauth-protected-resource ' +
            'document.',
        },
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
    twinPlan,
    ...(authMdPlan !== undefined ? { authMdPlan } : {}),
    ...(serverCardPlan ? { serverCardPlan } : {}),
    ...(llmsTxtResult.scaffoldedBody !== undefined
      ? { scaffoldedLlmsTxtBody: llmsTxtResult.scaffoldedBody }
      : {}),
  };
}
