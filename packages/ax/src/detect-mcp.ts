import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';

import type { AxEntryOverride } from './config-schema.js';
import { buildRouterModel, type RouterModel } from './router-model.js';
import { scrubSource } from './scrub-source.js';
import { buildArtifactUrl, buildUrn, NO_SITE_URL_HINT } from './site-url.js';
import type { CatalogEntry, EntryAuth } from './types.js';

// An existing MCP server is unambiguous intent to publish, so this is the one zero-config
// detector that runs with no opt-in marker. Detection is deliberately textual, not AST-based: a
// route file mounts an MCP server the Next.js way when it both imports the package and calls the
// handler factory it exports.
//
// Requiring both signals is not by itself enough for precision — a file can import the package for
// real *and* mention `createMcpHandler(` in a comment, which used to publish an endpoint that
// doesn't exist. So every regex below runs against `scrubSource(content)` (see scrub-source.ts):
// comment bodies and template-literal contents are blanked to spaces first, leaving offsets intact.
// Ordinary string literals are kept, because that is where the import specifier and the tool names
// actually live. This is a lexer-grade guard, not an AST one — see scrub-source.ts for its limits.
const MCP_IMPORT_RE =
  /from\s+['"](mcp-handler|@vercel\/mcp-adapter)['"]|require\(\s*['"](mcp-handler|@vercel\/mcp-adapter)['"]\s*\)/;
const MCP_HANDLER_CALL_RE = /createMcpHandler\s*\(/;
// Best-effort capability extraction: `<anything>.tool('name', ...)` calls in the same file,
// matching the MCP SDK's `server.tool(name, ...)` convention the mcp-adapter fixture uses. This is
// intentionally a plain regex, not a schema/AST evaluation — "populate capabilities where
// statically derivable" — cheaply. A file with no such calls simply gets none; this never invents
// a tool name that isn't a literal string in the source, and (running on scrubbed source) never
// picks up a `.tool('x')` that only appears in a comment or a template literal.
const TOOL_NAME_RE = /\.tool\(\s*['"`]([^'"`]+)['"`]/g;

// Auth detection: a mount wrapped in `mcp-handler`'s `withMcpAuth(handler, verifyToken, ...)` call
// (Clerk's official MCP path, and the ecosystem-idiomatic one) is gated. We key on the
// `withMcpAuth(` *call* specifically — not a bare `verifyToken` symbol, which is far too common a
// name to gate on without over-gating an open server. Detection stays textual on the
// already-`scrubSource`d content, so a mention in a comment/template can't misfire; a match only
// marks the surface as requiring auth (status "unknown"), never guesses the OAuth endpoints, which
// aren't statically derivable.
const WITH_MCP_AUTH_CALL_RE = /\bwithMcpAuth\s*\(/;
// The RFC 9728 protected-resource metadata path `withMcpAuth` is configured with, when declared as
// a literal — cross-linked into the server card so agents can discover the auth requirements.
const RESOURCE_METADATA_PATH_RE = /resourceMetadataPath\s*:\s*['"]([^'"]+)['"]/;

export interface DetectMcpMountsOptions {
  cwd: string;
  /** Reported via `generateCatalog`'s `onWarning` — never thrown, this detector never fails a build. */
  warn: (message: string) => void;
  /** The shared router model. Built from `cwd` when omitted, so the detector runs standalone. */
  router?: RouterModel;
}

export interface DetectMcpOptions extends DetectMcpMountsOptions {
  /** Absolute site origin (see site-url.ts), or undefined if none could be determined. */
  siteUrl: string | undefined;
  /** `next.config` `basePath`, or `''` if unset. */
  basePath: string;
}

/** A resolved `mcp-handler` mount: its source file, mounted URL pathname, and detected tool names. */
export interface McpMount {
  filePath: string;
  pathname: string;
  capabilities: string[];
  /** Auth posture when a `withMcpAuth`/`verifyToken` wrapper was detected; omitted otherwise. */
  auth?: EntryAuth;
  /** RFC 9728 metadata path from `withMcpAuth`'s `resourceMetadataPath`, when a literal was found. */
  resourceMetadataPath?: string;
}

/**
 * Scans the project's route handlers — App Router `route.*` and Pages Router `pages/api/**` — for
 * MCP servers mounted the Next.js way via `mcp-handler` (or its legacy alias `@vercel/mcp-adapter`)
 * and returns one `McpMount` per file that both imports the package and calls the handler factory,
 * once its route resolves to a stable URL pathname. Ambiguous mounts (an unrecognized dynamic route
 * segment) are skipped with a warning, never guessed. This is the shared detection step behind both
 * the catalog entry (`buildMcpEntries`) and the well-known server card (`buildMcpServerCardPlan`).
 */
export function detectMcpMounts(options: DetectMcpMountsOptions): McpMount[] {
  const router = options.router ?? buildRouterModel(options.cwd);
  const mounts: McpMount[] = [];

  for (const endpoint of router.listApiEndpoints()) {
    let content: string;
    try {
      content = scrubSource(readFileSync(endpoint.file, 'utf8'));
    } catch {
      continue;
    }
    if (!MCP_IMPORT_RE.test(content) || !MCP_HANDLER_CALL_RE.test(content)) continue;

    if (endpoint.url === undefined) {
      options.warn(
        `Found an MCP server mount (mcp-handler) at ${relative(options.cwd, endpoint.file)} but ` +
          "couldn't resolve a stable URL from its route segments — declare it manually via " +
          'ax.config "entries" instead of relying on zero-config detection.',
      );
      continue;
    }

    // ax can't probe the live server for OAuth metadata at build time, so a gated mount can only
    // ever be described as `status: 'unknown'` (requires auth; how is not statically derivable) —
    // mirroring Ora's "requires-auth but no metadata → unknown, never api_key". No wrapper → no
    // auth block at all (absence of a wrapper is not evidence the server is open).
    const gated = WITH_MCP_AUTH_CALL_RE.test(content);
    const auth: EntryAuth | undefined = gated ? { status: 'unknown' } : undefined;
    const resourceMetadataPath = gated ? RESOURCE_METADATA_PATH_RE.exec(content)?.[1] : undefined;

    mounts.push({
      filePath: endpoint.file,
      pathname: endpoint.url,
      capabilities: extractToolNames(content),
      ...(auth !== undefined ? { auth } : {}),
      ...(resourceMetadataPath !== undefined ? { resourceMetadataPath } : {}),
    });
  }

  return mounts;
}

/**
 * Detects MCP servers (see `detectMcpMounts`) and returns one `application/mcp-server-card+json`
 * catalog entry per mount that resolved to both a stable URL and a known site origin — the
 * convenience wrapper used where the mounts themselves aren't needed. Mounts that can't be resolved
 * to an absolute URL are skipped with a warning, never guessed — precision over recall.
 */
export function detectMcpServers(options: DetectMcpOptions): CatalogEntry[] {
  return buildMcpEntries({ ...options, mounts: detectMcpMounts(options) });
}

export interface BuildMcpEntriesOptions {
  mounts: McpMount[];
  siteUrl: string | undefined;
  basePath: string;
  warn: (message: string) => void;
}

/**
 * Turns resolved `McpMount`s into catalog entries. Kept separate from `detectMcpMounts` so
 * `generateCatalog` can scan once and feed the same mounts to both this and `buildMcpServerCardPlan`.
 * With no known site origin, emits no entry (warning instead) rather than a relative/guessed URL.
 */
export function buildMcpEntries(options: BuildMcpEntriesOptions): CatalogEntry[] {
  const { mounts } = options;
  if (mounts.length === 0) return [];

  const siteUrl = options.siteUrl;
  if (!siteUrl) {
    options.warn(
      `Found ${mounts.length === 1 ? 'an' : `${mounts.length}`} MCP server mount` +
        `${mounts.length === 1 ? '' : 's'} (mcp-handler) but no site URL is known — ${NO_SITE_URL_HINT}`,
    );
    return [];
  }

  const multiple = mounts.length > 1;
  return mounts.map((mount): CatalogEntry => {
    const identifier = mcpMountIdentifier(siteUrl, mount.pathname, multiple);
    return {
      identifier,
      type: 'application/mcp-server-card+json',
      displayName: 'MCP server',
      url: buildArtifactUrl(siteUrl, options.basePath, mount.pathname),
      updatedAt: statSync(mount.filePath).mtime.toISOString(),
      ...(mount.capabilities.length > 0 ? { capabilities: mount.capabilities } : {}),
      ...(mount.auth !== undefined ? { auth: mount.auth } : {}),
    };
  });
}

/**
 * The catalog identifier an MCP mount's entry gets — ARD URN format (spec §4.2.1): publisher
 * domain + logical name, with a second segment disambiguating only when the app mounts more than
 * one server. This is also the key a config entry override targets, so it's shared between
 * `buildMcpEntries` and `applyDeclaredMountAuth`.
 */
export function mcpMountIdentifier(siteUrl: string, pathname: string, multiple: boolean): string {
  return multiple ? buildUrn(siteUrl, 'mcp-server', pathname) : buildUrn(siteUrl, 'mcp-server');
}

export interface ApplyDeclaredMountAuthOptions {
  mounts: McpMount[];
  /** Config entry overrides whose `auth` was already sanitized (see `sanitizeOverrideAuth`). */
  overrides: readonly AxEntryOverride[];
  siteUrl: string | undefined;
  warn: (message: string) => void;
}

/**
 * Routes a config-declared `auth` on an MCP server's entry override into the mount itself, keyed
 * by the entry identifier the mount's card entry will carry. The mount — not the entry — is what
 * the server card and the generated `/auth.md` read, so without this an override's declared auth
 * would reach the catalog entry but leave both of those saying "scheme unknown". Runs *before*
 * mount gating resolves: a declared descriptor, like a detected `withMcpAuth` wrapper, marks the
 * mount gated and reviewed. Detection can only ever say `status: "unknown"` (the endpoints aren't
 * statically derivable), so a declaration refines it rather than contradicting it — except a
 * declared `"none"`, which would un-gate the surface; openness is what the review gate / committed
 * server card records, so that claim is warned and ignored.
 *
 * With no known site URL the identifiers can't be computed, so declared auth can't be matched to
 * a mount — but no MCP entries are emitted then either, and `buildMcpEntries` already warns about
 * the missing site URL, so this quietly changes nothing.
 */
export function applyDeclaredMountAuth(options: ApplyDeclaredMountAuthOptions): McpMount[] {
  const { mounts, overrides, siteUrl, warn } = options;
  if (mounts.length === 0) return mounts;
  const declaring = overrides.filter((override) => override.auth !== undefined);
  if (declaring.length === 0) return mounts;

  const multiple = mounts.length > 1;
  return mounts.map((mount) => {
    const override =
      siteUrl !== undefined
        ? declaring.find(
            (candidate) =>
              candidate.identifier === mcpMountIdentifier(siteUrl, mount.pathname, multiple),
          )
        : undefined;
    if (override?.auth === undefined) return mount;
    const declared = override.auth;
    if (declared.status === 'none') {
      warn(
        `Entry "${override.identifier}" declares auth.status "none" for the MCP server at ` +
          `${mount.pathname} — a declaration can describe how a gated server authenticates, but ` +
          "can't assert it open; that decision is recorded by the review gate / committed server " +
          'card. Ignoring it.',
      );
      return mount;
    }
    return { ...mount, auth: declared };
  });
}

function extractToolNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(TOOL_NAME_RE)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}
