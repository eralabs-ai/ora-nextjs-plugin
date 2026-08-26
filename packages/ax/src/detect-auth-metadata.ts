import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { safeHttpUrl, sanitizeDeclaredAuth } from './auth.js';
import { buildRouterModel, type RouterModel } from './router-model.js';
import { scrubSource } from './scrub-source.js';
import type { EntryAuthOAuth } from './types.js';

// Suggests where agents authenticate, from the app's own *committed* declarations — the same
// "declaration, not inference" discipline as every other detector, and the same idea as the
// siteUrl prefill: `ax init` asks for the auth endpoints, but a value the source tree already
// states becomes the editable default (named with its source), so the question is an informed
// check instead of homework. Never probes a live endpoint, never guesses provider-conventional
// paths from an issuer — a plausible-but-wrong prefill is worse than an empty prompt.
//
// Three committed sources, strongest first:
//   1. A static RFC 8414 authorization-server metadata document in `public/.well-known/` — the
//      app is its own OAuth server and its committed metadata *states* the endpoints verbatim.
//   2. `authServerUrls` string literals in a route handler — `mcp-handler`'s
//      `protectedResourceHandler({ authServerUrls: [...] })` (the ecosystem-idiomatic RFC 9728
//      route, e.g. the Clerk setup) names the authorization server(s), though not their endpoints.
//   3. A static RFC 9728 protected-resource metadata document in `public/.well-known/` — its
//      `authorization_servers` names the server(s), same as 2.
// 1 yields endpoint *prefills*; 2 and 3 yield issuer *context* the wizard shows next to the
// questions (an issuer's endpoints live behind its own /.well-known, which ax won't fetch).

/** RFC 8414 authorization-server metadata basenames a site can commit statically. */
const AS_METADATA_PATHS = [
  join('public', '.well-known', 'oauth-authorization-server'),
  join('public', '.well-known', 'oauth-authorization-server.json'),
];

/** RFC 9728 protected-resource metadata basenames a site can commit statically. */
const RESOURCE_METADATA_PATHS = [
  join('public', '.well-known', 'oauth-protected-resource'),
  join('public', '.well-known', 'oauth-protected-resource.json'),
];

/** `authServerUrls: [ ... ]` in a route handler (mcp-handler's protectedResourceHandler option). */
const AUTH_SERVER_URLS_RE = /\bauthServerUrls\s*:\s*\[([^\]]*)\]/;
const STRING_LITERAL_RE = /['"]([^'"]+)['"]/g;

// A *call* to a protected-resource metadata handler — mcp-handler's `protectedResourceHandler(`
// (whose `authServerUrls` literal also names the issuer) or a provider-flavored variant like
// @clerk/mcp-tools' `protectedResourceHandlerClerk(`, which derives the authorization server from
// env at runtime, so there is no committed issuer literal to read. Either way the wiring itself
// is committed evidence that this app's gated surface speaks OAuth.
const PROTECTED_RESOURCE_HANDLER_RE = /\bprotectedResourceHandler[A-Za-z]*\s*\(/;

export interface AuthMetadataSuggestion {
  /** Endpoint prefills — present only when a committed document literally states them (source 1). */
  oauth?: EntryAuthOAuth;
  /** Where `oauth` came from, relative to the project root. */
  oauthSource?: string;
  /** Declared OAuth authorization server(s) (issuer URLs), deduped — context, not prefills. */
  issuers: string[];
  /** Where the first issuer declaration was found, relative to the project root. */
  issuersSource?: string;
  /**
   * A wired RFC 9728 protected-resource route (relative source path), when one exists. Set even
   * when no issuer literal is readable (a provider-flavored handler resolves it from env at
   * runtime) — the wiring alone is committed evidence the gated surface speaks OAuth, which the
   * wizard uses for its scheme default and to say endpoints are agent-discoverable at runtime.
   */
  resourceMetadataRoute?: string;
}

export interface DetectAuthMetadataOptions {
  cwd: string;
  /** The shared router model. Built from `cwd` when omitted, so the detector runs standalone. */
  router?: RouterModel;
}

/** Best-effort static JSON read: undefined on missing file, bad JSON, or a non-object root. */
function readJsonObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Scans the committed sources above and returns whatever they state. Every URL passes the same
 * `safeHttpUrl` secret-guard as detected/declared descriptors, so a suggestion can never carry a
 * non-http(s) value into a prompt default (which the user would then approve into ax.config).
 */
export function detectAuthMetadata(options: DetectAuthMetadataOptions): AuthMetadataSuggestion {
  const { cwd } = options;
  const suggestion: AuthMetadataSuggestion = { issuers: [] };

  // 1. Committed RFC 8414 AS metadata — the one source that states endpoints verbatim.
  for (const candidate of AS_METADATA_PATHS) {
    const doc = readJsonObject(join(cwd, candidate));
    if (doc === undefined) continue;
    // Route the raw document through the declared-auth sanitizer: same field whitelist, same URL
    // guard, same caps — one discipline for every auth value ax handles.
    const { auth } = sanitizeDeclaredAuth({
      status: 'oauth2',
      oauth: {
        authorizationEndpoint: doc.authorization_endpoint,
        tokenEndpoint: doc.token_endpoint,
        registrationEndpoint: doc.registration_endpoint,
        scopesSupported: doc.scopes_supported,
      },
    });
    if (auth?.oauth !== undefined) {
      suggestion.oauth = auth.oauth;
      suggestion.oauthSource = candidate;
    }
    const issuer = safeHttpUrl(doc.issuer);
    if (issuer !== undefined) addIssuer(suggestion, issuer, candidate);
    break;
  }

  // 2. `authServerUrls` literals in route handlers (protectedResourceHandler mounts). The route
  // walker skips hidden directories, which is exactly where the idiomatic mount lives
  // (`app/.well-known/oauth-protected-resource/route.*`) — so that conventional location is
  // checked directly on top of the general endpoint list.
  const router = options.router ?? buildRouterModel(cwd);
  const candidateFiles = router.listApiEndpoints().map((endpoint) => endpoint.file);
  if (router.appDir !== undefined) {
    for (const ext of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']) {
      const conventional = join(
        router.appDir,
        '.well-known',
        'oauth-protected-resource',
        `route.${ext}`,
      );
      if (existsSync(conventional)) candidateFiles.push(conventional);
    }
  }
  for (const file of candidateFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!content.includes('authServerUrls') && !content.includes('protectedResourceHandler')) {
      continue;
    }
    // Scrubbed like every textual detector: a mention in a comment or template literal never fires.
    const scrubbed = scrubSource(content);
    if (
      suggestion.resourceMetadataRoute === undefined &&
      PROTECTED_RESOURCE_HANDLER_RE.test(scrubbed)
    ) {
      suggestion.resourceMetadataRoute = relative(cwd, file);
    }
    const match = AUTH_SERVER_URLS_RE.exec(scrubbed);
    if (match?.[1] === undefined) continue;
    for (const literal of match[1].matchAll(STRING_LITERAL_RE)) {
      const issuer = safeHttpUrl(literal[1]);
      if (issuer !== undefined) addIssuer(suggestion, issuer, relative(cwd, file));
    }
  }

  // 3. Committed RFC 9728 protected-resource metadata — `authorization_servers` names the AS.
  for (const candidate of RESOURCE_METADATA_PATHS) {
    const doc = readJsonObject(join(cwd, candidate));
    if (doc === undefined || !Array.isArray(doc.authorization_servers)) continue;
    for (const value of doc.authorization_servers) {
      const issuer = safeHttpUrl(value);
      if (issuer !== undefined) addIssuer(suggestion, issuer, candidate);
    }
    break;
  }

  return suggestion;
}

function addIssuer(suggestion: AuthMetadataSuggestion, issuer: string, source: string): void {
  if (suggestion.issuers.includes(issuer)) return;
  suggestion.issuers.push(issuer);
  suggestion.issuersSource ??= source;
}
