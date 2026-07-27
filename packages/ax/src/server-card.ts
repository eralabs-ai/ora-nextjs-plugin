import type { McpMount } from './detect-mcp.js';
import type { SiteMetadata } from './site-metadata.js';
import { buildArtifactUrl } from './site-url.js';

// A working `mcp-handler` server needs to be discoverable at the well-known **server card** path,
// not just via the ARD catalog entry: agent registries and crawlers look for
// /.well-known/mcp/server-card.json to confirm a live MCP server, so the catalog entry alone isn't
// enough signal. This module builds that card from the mount the plugin already detects.
//
// The shape is a **superset** of two conventions, since there's no single pinned schema for this
// file yet:
//   1. MCP registry `server.json` (reverse-DNS `name`, `remotes[]`) + top-level `serverUrl`/`tools[]`.
//   2. SEP-1649 / PR-2127 server card (`serverInfo`, `transport.endpoint`, `capabilities`) —
//      `transport.endpoint` is the SEP-defined home for the server URL, which some readers expect
//      there instead of the top-level `serverUrl`.
// Emitting both shapes satisfies readers expecting either convention without guessing — every value
// is derived from the detected mount, package.json, and resolved site origin. Still no
// `$schema`/`protocolVersion` guessed (unknowable statically) and no `authentication` block asserted
// (auth declaration isn't derivable statically).

export interface McpServerCardTool {
  name: string;
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
}

export interface BuildMcpServerCardOptions {
  /** Mounts from `detectMcpMounts` — scanned once and shared with `buildMcpEntries`. */
  mounts: McpMount[];
  /** Absolute site origin, or undefined if none could be determined. */
  siteUrl: string | undefined;
  /** `next.config` `basePath`, or `''` if unset. */
  basePath: string;
  /** Site facts (name/description/version) that stamp the card's identity fields. */
  site: SiteMetadata;
  /** Advisory recommendation channel (not a warning — nothing is broken). */
  recommend: (message: string) => void;
}

/**
 * Builds the well-known MCP server card, or returns undefined when there's nothing to emit.
 *
 * Returns undefined silently when there are no mounts or no known site origin — the latter is
 * already warned about by `buildMcpEntries`, so the card stays quiet rather than double-report. When
 * more than one MCP server is mounted, the single well-known path is ambiguous, so this emits a
 * recommendation and skips (precision over recall — never guess which server the card describes).
 */
export function buildMcpServerCard(options: BuildMcpServerCardOptions): McpServerCard | undefined {
  const { mounts, siteUrl, basePath, site } = options;
  if (mounts.length === 0 || !siteUrl) return undefined;

  if (mounts.length > 1) {
    options.recommend(
      `Detected ${mounts.length} MCP server mounts, but a well-known server card lives at a single ` +
        'path (/.well-known/mcp/server-card.json) — ax skipped emitting one. Publish a ' +
        'server card for your primary server by hand so agents can discover it.',
    );
    return undefined;
  }

  const mount = mounts[0];
  if (mount === undefined) return undefined;

  const serverUrl = buildArtifactUrl(siteUrl, basePath, mount.pathname);

  const version = site.version ?? '0.0.0';

  return {
    name: buildServerName(siteUrl, site.displayName),
    description: site.description ?? `${site.displayName} MCP server`,
    version,
    serverUrl,
    remotes: [{ type: 'streamable-http', url: serverUrl }],
    tools: mount.capabilities.map((name) => ({ name })),
    serverInfo: { name: site.displayName, version },
    transport: { type: 'streamable-http', endpoint: serverUrl },
    capabilities: { tools: {} },
  };
}

/**
 * Builds the registry-format `name`: the site's host reversed to reverse-DNS, a slash, then a slug
 * of the display name — e.g. `example.com` + `My App` -> `com.example/my-app`. Sanitized to the
 * conservative `[a-z0-9._-]` alphabet the MCP registry name pattern accepts.
 */
function buildServerName(siteUrl: string, displayName: string): string {
  const host = new URL(siteUrl).hostname;
  const reversed = host.split('.').reverse().join('.');
  const slug = slugify(displayName) || 'mcp-server';
  return `${reversed}/${slug}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
