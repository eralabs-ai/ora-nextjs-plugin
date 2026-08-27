import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import type { McpMount } from './detect-mcp.js';
import { entryUrlPath } from './entries.js';
import { isGeneratedMarkdown, renderFrontmatter } from './markdown-artifact.js';
import { absoluteOrServedUrl, servedPath } from './site-url.js';
import type { CatalogEntry, EntryAuth } from './types.js';

// Generated `/auth.md`: what a gated route should hand an agent instead of a soft auth wall. One
// markdown document aggregating what agents actually need — which surfaces are gated, what scheme
// each uses, and where a human obtains credentials — derived entirely from the same secret-free
// EntryAuth descriptors the catalog publishes, so it can never leak or over-claim. One honest,
// derivable artifact doing the job N invented gated-page twins would do badly (a gated page's
// prerender is a login shell; see markdown-twins.ts).
//
// Regenerated every build to `public/auth.md`, with the same frontmatter contract as the twins.
// When no gated surface exists the document is not written at all (and a previously generated one
// is removed): an auth guide with nothing to say would itself be noise an agent has to read.

/** The auth.md URL pathname (basePath-prefixed at serve time). */
export const AUTH_MD_PATHNAME = '/auth.md';

/** One gated surface as auth.md presents it. */
interface AuthSurface {
  /** Served path of the gated surface (or of the document describing it, for an API). */
  path: string;
  heading: string;
  kindLine: string;
  auth: EntryAuth;
  /** RFC 9728 protected-resource metadata path, when an MCP mount declared one. */
  resourceMetadataPath?: string;
}

export interface BuildAuthMdOptions {
  /** Resolved MCP mounts (post-gating), whose `auth` marks the gated ones. */
  mounts: McpMount[];
  /** The final published entry set (post-gating), whose `auth` descriptors mark gated surfaces. */
  entries: readonly CatalogEntry[];
  siteUrl: string | undefined;
  basePath: string;
  siteDisplayName: string;
  /** Injectable clock for deterministic tests; defaults to the wall clock. */
  now?: Date;
}

export interface AuthMdPlan {
  /** Full file contents (frontmatter + body). */
  content: string;
  /** Served URL path, basePath-prefixed. */
  servedPath: string;
  /** How many gated surfaces the document describes. */
  surfaceCount: number;
}

/** How a status reads to a human/agent; endpoints and links are appended per surface. */
const STATUS_LINE: Record<EntryAuth['status'], string> = {
  oauth2: 'OAuth 2.0',
  api_key: 'API key',
  none: 'none declared',
  unknown: 'required — the scheme is not statically derivable from the source',
};

/**
 * Builds the generated `/auth.md`, or returns undefined when nothing is gated. Pure — the CLI
 * writes it (see {@link applyAuthMdPlan}) after the review gate, alongside the twins.
 */
export function buildAuthMd(options: BuildAuthMdOptions): AuthMdPlan | undefined {
  const { basePath, siteUrl } = options;
  const surfaces: AuthSurface[] = [];

  for (const mount of options.mounts) {
    if (mount.auth === undefined) continue;
    const path = servedPath(basePath, mount.pathname);
    surfaces.push({
      path,
      heading: `MCP server at ${path}`,
      kindLine: 'An MCP (Model Context Protocol) server. Connecting requires authentication.',
      auth: mount.auth,
      ...(mount.resourceMetadataPath !== undefined
        ? { resourceMetadataPath: servedPath(basePath, mount.resourceMetadataPath) }
        : {}),
    });
  }

  for (const entry of options.entries) {
    if (entry.type === 'application/mcp-server-card+json') continue; // covered by its mount above
    if (entry.auth === undefined || entry.auth.status === 'none') continue;
    const path = entryUrlPath(entry);
    if (path === undefined) continue;
    const isOpenApi =
      typeof entry.type === 'string' && entry.type.startsWith('application/vnd.oai.openapi+json');
    surfaces.push({
      path,
      heading: isOpenApi
        ? `HTTP API (described by ${path})`
        : `${entry.displayName ?? entry.identifier} at ${path}`,
      kindLine: isOpenApi
        ? `The HTTP API documented by [${path}](${absoluteOrServedUrl(siteUrl, '', path)}) ` +
          'requires authentication; the OpenAPI document declares the scheme(s).'
        : 'A gated surface declared by this site.',
      auth: entry.auth,
    });
  }

  if (surfaces.length === 0) return undefined;
  surfaces.sort((a, b) => a.path.localeCompare(b.path));

  const now = options.now ?? new Date();
  const frontmatter = renderFrontmatter({
    title: `Authentication — ${options.siteDisplayName}`,
    description: 'How to obtain access to the gated surfaces on this site.',
    canonicalUrl: absoluteOrServedUrl(siteUrl, basePath, AUTH_MD_PATHNAME),
    lastUpdated: now.toISOString(),
  });

  const sections = surfaces.map((surface) => {
    const lines = [`## ${surface.heading}`, '', surface.kindLine, ''];
    lines.push(`- Auth: ${STATUS_LINE[surface.auth.status]}`);
    const oauth = surface.auth.oauth;
    if (oauth?.authorizationEndpoint !== undefined) {
      lines.push(`- Authorization endpoint: <${oauth.authorizationEndpoint}>`);
    }
    if (oauth?.tokenEndpoint !== undefined)
      lines.push(`- Token endpoint: <${oauth.tokenEndpoint}>`);
    if (oauth?.registrationEndpoint !== undefined) {
      lines.push(`- Dynamic client registration: <${oauth.registrationEndpoint}>`);
    }
    if (oauth?.scopesSupported !== undefined && oauth.scopesSupported.length > 0) {
      lines.push(`- Scopes: ${oauth.scopesSupported.map((scope) => `\`${scope}\``).join(', ')}`);
    }
    if (surface.resourceMetadataPath !== undefined) {
      lines.push(
        `- Auth requirements (RFC 9728 protected-resource metadata): ` +
          `[${surface.resourceMetadataPath}](${absoluteOrServedUrl(siteUrl, '', surface.resourceMetadataPath)})`,
      );
    }
    // The docsUrl nudge only applies where a human must fetch a credential somewhere. An OAuth
    // surface is self-service — the agent's client runs the sign-in flow — so with no docsUrl the
    // honest line is how access actually works, not a nag for a page that has no job.
    lines.push(
      surface.auth.docsUrl !== undefined
        ? `- Get access: <${surface.auth.docsUrl}>`
        : surface.auth.status === 'oauth2'
          ? '- Get access: sign in through your MCP client via OAuth — no manually issued credentials.'
          : '- Get access: not documented yet. (Site owner: declare `auth.docsUrl` on this entry in ' +
            'ax.config to link where credentials are obtained.)',
    );
    return lines.join('\n');
  });

  const plural = surfaces.length !== 1;
  const body = [
    '# Authentication',
    '',
    `${options.siteDisplayName} has ${surfaces.length} gated surface${plural ? 's' : ''}. This ` +
      "document is generated at build time from the site's own committed auth declarations — it " +
      'describes how to authenticate and never contains credentials.',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');

  return {
    content: `${frontmatter}\n${body}`,
    servedPath: servedPath(basePath, AUTH_MD_PATHNAME),
    surfaceCount: surfaces.length,
  };
}

export interface ApplyAuthMdResult {
  /** Path written, relative to the project root, when the plan was written. */
  written?: string;
  /** Path deleted (a previously generated auth.md with nothing left to describe). */
  deleted?: string;
}

/**
 * Writes the planned `public/auth.md`, or — when there is no plan — removes a previously
 * *generated* one (never a user-authored file: the generated-by marker is the guard, same as
 * twins). Filesystem errors warn rather than throw.
 */
export function applyAuthMdPlan(
  cwd: string,
  plan: AuthMdPlan | undefined,
  warn: (message: string) => void,
): ApplyAuthMdResult {
  const filePath = join(cwd, 'public', 'auth.md');

  if (plan === undefined) {
    if (!existsSync(filePath)) return {};
    try {
      if (!isGeneratedMarkdown(readFileSync(filePath, 'utf8'))) return {};
      rmSync(filePath, { force: true });
      return { deleted: relative(cwd, filePath) };
    } catch (err) {
      warn(`Could not remove the stale public/auth.md (${(err as Error).message}).`);
      return {};
    }
  }

  try {
    if (existsSync(filePath) && !isGeneratedMarkdown(readFileSync(filePath, 'utf8'))) {
      warn(
        'public/auth.md exists but was not generated by ax — leaving it untouched. Delete it if ' +
          'you want the generated auth guide instead.',
      );
      return {};
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, plan.content, 'utf8');
    return { written: relative(cwd, filePath) };
  } catch (err) {
    warn(`Could not write public/auth.md (${(err as Error).message}).`);
    return {};
  }
}
