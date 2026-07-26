import { readFileSync, statSync } from 'node:fs';

import { findAppDir } from './app-dir.js';
import { buildArtifactUrl, buildUrn } from './site-url.js';
import type { CatalogEntry } from './types.js';
import { pathSegments, ROUTE_FILE_NAMES, walkFiles } from './walk-files.js';

// An existing MCP server is unambiguous intent to publish, so this is the one zero-config
// detector that runs with no opt-in marker. Detection is deliberately textual, not AST-based: a
// route file mounts an MCP server the Next.js way when it both imports the package and calls the
// handler factory it exports; requiring both textual signals cuts down on false positives from a
// file that merely mentions the package name in a comment or unrelated string, without the cost of
// a full AST parse.
const MCP_IMPORT_RE =
  /from\s+['"](mcp-handler|@vercel\/mcp-adapter)['"]|require\(\s*['"](mcp-handler|@vercel\/mcp-adapter)['"]\s*\)/;
const MCP_HANDLER_CALL_RE = /createMcpHandler\s*\(/;
// Best-effort capability extraction: `<anything>.tool('name', ...)` calls in the same file,
// matching the MCP SDK's `server.tool(name, ...)` convention the mcp-adapter fixture uses. This is
// intentionally a plain regex, not a schema/AST evaluation — "populate capabilities where
// statically derivable" — cheaply. A file with no such calls simply gets none; this never invents
// a tool name that isn't a literal string in the source.
const TOOL_NAME_RE = /\.tool\(\s*['"`]([^'"`]+)['"`]/g;

export interface DetectMcpMountsOptions {
  cwd: string;
  /** Reported via `generateCatalog`'s `onWarning` — never thrown, this detector never fails a build. */
  warn: (message: string) => void;
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
}

/**
 * Scans `app/` for MCP servers mounted the Next.js way via `mcp-handler` (or its legacy alias
 * `@vercel/mcp-adapter`) and returns one `McpMount` per file that both imports the package and calls
 * the handler factory, once its route segments resolve to a stable URL pathname. Ambiguous mounts
 * (an unrecognized dynamic route segment) are skipped with a warning, never guessed. This is the
 * shared detection step behind both the catalog entry (`buildMcpEntries`) and the well-known server
 * card (`buildMcpServerCard`), so `app/` is only walked once per build.
 */
export function detectMcpMounts(options: DetectMcpMountsOptions): McpMount[] {
  const appDir = findAppDir(options.cwd);
  if (!appDir) return [];

  const routeFiles = walkFiles(appDir, (name) => ROUTE_FILE_NAMES.has(name));
  const mounts: McpMount[] = [];

  for (const file of routeFiles) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }
    if (!MCP_IMPORT_RE.test(content) || !MCP_HANDLER_CALL_RE.test(content)) continue;

    const pathname = resolveMcpPathname(file.relativeDir);
    if (pathname === undefined) {
      options.warn(
        `Found an MCP server mount (mcp-handler) at ${file.relativeDir || '.'} but couldn't ` +
          'resolve a stable URL from its route segments — declare it manually via ard.config ' +
          '"entries" instead of relying on zero-config detection.',
      );
      continue;
    }

    mounts.push({ filePath: file.absolutePath, pathname, capabilities: extractToolNames(content) });
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
 * `generateCatalog` can scan once and feed the same mounts to both this and `buildMcpServerCard`.
 * With no known site origin, emits no entry (warning instead) rather than a relative/guessed URL.
 */
export function buildMcpEntries(options: BuildMcpEntriesOptions): CatalogEntry[] {
  const { mounts } = options;
  if (mounts.length === 0) return [];

  const siteUrl = options.siteUrl;
  if (!siteUrl) {
    options.warn(
      `Found ${mounts.length === 1 ? 'an' : `${mounts.length}`} MCP server mount` +
        `${mounts.length === 1 ? '' : 's'} (mcp-handler) but no site URL is known — set ` +
        '"siteUrl" in ard.config, or deploy on Vercel, to include it in the catalog.',
    );
    return [];
  }

  const multiple = mounts.length > 1;
  return mounts.map((mount): CatalogEntry => {
    // ARD URN format (spec §4.2.1): publisher domain + logical name; a second segment
    // disambiguates only when the app mounts more than one server.
    const identifier = multiple
      ? buildUrn(siteUrl, 'mcp-server', mount.pathname)
      : buildUrn(siteUrl, 'mcp-server');
    return {
      identifier,
      type: 'application/mcp-server-card+json',
      displayName: 'MCP server',
      url: buildArtifactUrl(siteUrl, options.basePath, mount.pathname),
      updatedAt: statSync(mount.filePath).mtime.toISOString(),
      ...(mount.capabilities.length > 0 ? { capabilities: mount.capabilities } : {}),
    };
  });
}

/**
 * Converts a route file's directory (relative to `app/`) into the URL path it's mounted at.
 * Route groups (`(name)`) contribute no URL segment. A `[transport]` segment — the exact name
 * `mcp-handler`'s own docs and CLI scaffold use — resolves to `mcp`, its documented default
 * `streamableHttpEndpoint` (verified against `mcp-handler`'s own type declarations). Any other
 * dynamic (`[id]`) or parallel-route (`@slot`) segment makes the mount's real URL ambiguous from
 * static inspection alone, so this returns undefined rather than guess.
 */
function resolveMcpPathname(relativeDir: string): string | undefined {
  const resolved: string[] = [];
  for (const segment of pathSegments(relativeDir)) {
    if (segment.startsWith('(') && segment.endsWith(')')) continue;
    if (segment === '[transport]') {
      resolved.push('mcp');
      continue;
    }
    if (/[[\]@]/.test(segment)) return undefined;
    resolved.push(segment);
  }
  return `/${resolved.join('/')}`;
}

function extractToolNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(TOOL_NAME_RE)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}
