import type { McpMount } from './detect-mcp.js';
import type { SiteMetadata } from './site-metadata.js';
import { buildArtifactUrl, servedPath } from './site-url.js';

// A working `mcp-handler` server needs to be discoverable at the well-known **server card** path,
// not just via the ARD catalog entry: agent registries and crawlers look for
// /.well-known/mcp/server-card.json to confirm a live MCP server, so the catalog entry alone isn't
// enough signal. This module builds those cards from the mounts the plugin already detects.
//
// The card shape is a **superset** of two conventions, since there's no single pinned schema for
// this file yet:
//   1. MCP registry `server.json` (reverse-DNS `name`, `remotes[]`) + top-level `serverUrl`/`tools[]`.
//   2. SEP-1649 / PR-2127 server card (`serverInfo`, `transport.endpoint`, `capabilities`) —
//      `transport.endpoint` is the SEP-defined home for the server URL, which some readers expect
//      there instead of the top-level `serverUrl`.
// Emitting both shapes satisfies readers expecting either convention without guessing — every value
// is derived from the detected mount, package.json, and resolved site origin. Still no
// `$schema`/`protocolVersion` guessed (unknowable statically). An `authentication` block appears
// only when the mount is detectably gated (a `withMcpAuth`/`verifyToken` wrapper): it asserts that
// the server requires auth and, when `withMcpAuth`'s `resourceMetadataPath` is a literal,
// cross-links the RFC 9728 metadata — never guesses the OAuth endpoints, and never asserts "open".
//
// Multi-server hosts get one card per mount. The SEP-2127 discovery draft supports this, but its
// path scheme has moved twice (currently `<mcp-endpoint>/server-card` + a `/.well-known/
// ai-catalog.json` catalog), while the agent registries ax targets probe
// /.well-known/mcp/server-card.json. So ax extends the probed namespace rather than chase the
// draft: the PRIMARY server's card lives at the root path registries fetch, and every server's
// card also lives at /.well-known/mcp/server-card/<server-name>.json — a predictable per-server
// slot derived from the mount's own pathname. Revisit the scheme once SEP-2127 merges.

export interface McpServerCardTool {
  name: string;
}

/**
 * Auth block on the card — present only for a detectably-gated mount. `required: true` states the
 * server needs auth; `resourceMetadata` (RFC 9728) is included only when `withMcpAuth` declared a
 * `resourceMetadataPath` literal ax could resolve to an absolute URL.
 */
export interface McpServerCardAuthentication {
  required: true;
  resourceMetadata?: string;
}

export interface McpServerCardRemote {
  type: 'streamable-http';
  url: string;
}

export interface McpServerCard {
  /** Reverse-DNS name with one slash (registry format), e.g. `com.example/my-app`. */
  name: string;
  description: string;
  version: string;
  /** Top-level endpoint agent registries read to confirm a live MCP server. */
  serverUrl: string;
  remotes: McpServerCardRemote[];
  tools: McpServerCardTool[];
  /** SEP-1649 / PR-2127 fields — the URL-bearing shape some registries expect instead. */
  serverInfo: { name: string; version: string };
  transport: { type: 'streamable-http'; endpoint: string };
  capabilities: { tools: Record<string, unknown> };
  /** Present only for a detectably-gated mount — never asserts "open" (see module comment). */
  authentication?: McpServerCardAuthentication;
}

/** One card to emit: which mount it describes, its per-server name, and whether it owns the root path. */
export interface McpServerCardEmission {
  card: McpServerCard;
  /** The described mount's URL pathname (pre-basePath) — the join key back to mounts and entries. */
  mountPathname: string;
  /** The per-server name: the filename of the card's named slot (server-card/<name>.json). */
  serverName: string;
  /**
   * Whether this card also owns the root well-known path (/.well-known/mcp/server-card.json) —
   * the path registries probe. Exactly one emission is primary.
   */
  primary: boolean;
}

/** Every server card this build should emit. `cards` lists the primary first. */
export interface McpServerCardPlan {
  cards: McpServerCardEmission[];
  /**
   * Whether per-server named cards are emitted alongside the root card. True only with several
   * mounts — a single server owns the root path outright and needs no named slot.
   */
  multi: boolean;
}

export interface BuildMcpServerCardPlanOptions {
  /** Mounts from `detectMcpMounts` — scanned once and shared with `buildMcpEntries`. */
  mounts: McpMount[];
  /**
   * The mount whose card owns the root well-known path. A judgment call ax never guesses on its
   * own: the caller resolves it from the committed root card, the wizard/review-gate answer, or
   * the public-server default. Ignored (trivially the only mount) for a single mount; with several
   * mounts, an unknown value falls back to the first mount.
   */
  primaryPathname?: string | undefined;
  /** Absolute site origin, or undefined if none could be determined. */
  siteUrl: string | undefined;
  /** `next.config` `basePath`, or `''` if unset. */
  basePath: string;
  /** Site facts (name/description/version) that stamp the cards' identity fields. */
  site: SiteMetadata;
}

/**
 * Builds the well-known MCP server card plan, or returns undefined when there's nothing to emit.
 * Returns undefined silently when there are no mounts or no known site origin — the latter is
 * already warned about by `buildMcpEntries`, so the cards stay quiet rather than double-report.
 */
export function buildMcpServerCardPlan(
  options: BuildMcpServerCardPlanOptions,
): McpServerCardPlan | undefined {
  const { mounts, siteUrl, basePath, site } = options;
  if (mounts.length === 0 || !siteUrl) return undefined;

  const multi = mounts.length > 1;
  const primaryPathname =
    (multi && mounts.some((mount) => mount.pathname === options.primaryPathname)
      ? options.primaryPathname
      : undefined) ?? mounts[0]?.pathname;

  const cards = mounts.map((mount): McpServerCardEmission => ({
    card: buildCard(mount, { siteUrl, basePath, site, multi }),
    mountPathname: mount.pathname,
    serverName: mountServerName(mount.pathname),
    primary: mount.pathname === primaryPathname,
  }));
  cards.sort((a, b) => Number(b.primary) - Number(a.primary));
  return { cards, multi };
}

function buildCard(
  mount: McpMount,
  context: { siteUrl: string; basePath: string; site: SiteMetadata; multi: boolean },
): McpServerCard {
  const { siteUrl, basePath, site, multi } = context;
  const serverUrl = buildArtifactUrl(siteUrl, basePath, mount.pathname);
  const version = site.version ?? '0.0.0';

  const authentication: McpServerCardAuthentication | undefined = mount.auth
    ? {
        required: true,
        ...(mount.resourceMetadataPath !== undefined
          ? { resourceMetadata: buildArtifactUrl(siteUrl, basePath, mount.resourceMetadataPath) }
          : {}),
      }
    : undefined;

  return {
    // With several servers the site-wide display name can't tell them apart, so each card's
    // identity comes from its own mount: the name's slug and the description both carry the
    // served path. A single server keeps the site-level identity (unchanged output).
    name: multi
      ? buildServerName(siteUrl, mountServerName(mount.pathname))
      : buildServerName(siteUrl, slugify(site.displayName)),
    description: multi
      ? `${site.displayName} MCP server at ${servedPath(basePath, mount.pathname)}`
      : (site.description ?? `${site.displayName} MCP server`),
    version,
    serverUrl,
    remotes: [{ type: 'streamable-http', url: serverUrl }],
    tools: mount.capabilities.map((name) => ({ name })),
    serverInfo: { name: site.displayName, version },
    transport: { type: 'streamable-http', endpoint: serverUrl },
    capabilities: { tools: {} },
    ...(authentication !== undefined ? { authentication } : {}),
  };
}

/**
 * The per-server name a mount's named card slot is keyed by: the mount's own pathname, slugified
 * (`/api/public/mcp` → `api-public-mcp`). Pathname-derived so it's unique per mount and stable
 * across builds — it doubles as the read-back key for the gating decision the card records.
 */
export function mountServerName(pathname: string): string {
  return slugify(pathname.split('/').filter(Boolean).join('-')) || 'mcp-server';
}

/**
 * Builds the registry-format `name`: the site's host reversed to reverse-DNS, a slash, then the
 * given slug — e.g. `example.com` + `my-app` -> `com.example/my-app`. Sanitized to the
 * conservative `[a-z0-9._-]` alphabet the MCP registry name pattern accepts.
 */
function buildServerName(siteUrl: string, slug: string): string {
  const host = new URL(siteUrl).hostname;
  const reversed = host.split('.').reverse().join('.');
  return `${reversed}/${slug || 'mcp-server'}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
