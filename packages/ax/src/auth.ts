// Derives the secret-free `auth` descriptor ax emits on catalog entries, mirroring how Ora's
// registry projects auth from the same sources (its `src/lib/ard/resource-projection.ts`). Two
// disciplines carry over so a first-party catalog's `auth` block survives Ora's crawl-time
// re-validation (its `sanitizeEntryAuth`), and so ax never leaks a secret or over-claims:
//   - Only structural facts cross: status, endpoint URLs, and scope *keys* — never a token/key
//     value, never `description` prose. URL fields must be http(s) (the secret-guard: a
//     `javascript:`/`data:`/relative value is dropped, not emitted), and lists are capped.
//   - ax reads the app's own committed declaration — a static `public/openapi.json`'s
//     `securitySchemes`, or a `withMcpAuth`/`verifyToken` wrapper on an MCP mount. It never probes
//     a live endpoint (a build-time tool can't) and never infers "open" from the absence of a
//     signal (auth may live in middleware/a proxy). MCP gated-but-undescribable is `"unknown"`,
//     never `"none"` and never `api_key`.

import type { EntryAuth, EntryAuthOAuth } from './types.js';

/** Cap list fields so a descriptor never balloons (matches Ora's re-validation caps). */
const MAX_SCOPES = 32;
/** Longest string ax will carry into an auth field (matches Ora's re-validation caps). */
const MAX_STRING_CHARS = 256;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * An in-bounds string that parses as an http(s) URL, else undefined. This is the secret-guard for
 * URL-bearing fields: endpoint URLs render as links downstream, so a non-http(s) scheme (or a
 * relative/overlong value) must never survive into the catalog.
 */
export function safeHttpUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_STRING_CHARS) return undefined;
  try {
    const parsed = new URL(v);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Minimal shape of the parts of an OpenAPI doc this reads. Everything is `unknown` until checked. */
interface OpenApiLike {
  components?: unknown;
}

/**
 * Derive the auth posture from a parsed OpenAPI doc's `components.securitySchemes`, exactly as Ora
 * does: an `oauth2`/`openIdConnect` scheme wins (`oauth2`, with endpoints + scope keys from its
 * first flow, `authorizationCode` preferred); any `apiKey` or `http` bearer/basic → `api_key`; a
 * doc that declares no schemes → `none` (the developer's own committed doc says the surface is
 * open — a declaration, not an inference). The doc is always present when this is called, so it
 * always returns a descriptor.
 */
export function authForOpenApi(doc: OpenApiLike): EntryAuth {
  const components = isObject(doc.components) ? doc.components : undefined;
  const schemes =
    components && isObject(components.securitySchemes) ? components.securitySchemes : undefined;
  if (!schemes || Object.keys(schemes).length === 0) {
    return { status: 'none' };
  }

  const values = Object.values(schemes).filter(isObject);
  const oauthScheme = values.find((s) => s.type === 'oauth2' || s.type === 'openIdConnect');
  if (oauthScheme) {
    const flows = isObject(oauthScheme.flows) ? oauthScheme.flows : undefined;
    const flow = flows
      ? (flows.authorizationCode ??
        flows.implicit ??
        flows.clientCredentials ??
        flows.password ??
        Object.values(flows).find(isObject))
      : undefined;
    const oauth: EntryAuthOAuth = {};
    if (isObject(flow)) {
      const authorizationEndpoint = safeHttpUrl(flow.authorizationUrl);
      if (authorizationEndpoint) oauth.authorizationEndpoint = authorizationEndpoint;
      const tokenEndpoint = safeHttpUrl(flow.tokenUrl);
      if (tokenEndpoint) oauth.tokenEndpoint = tokenEndpoint;
      if (isObject(flow.scopes)) {
        const scopes = Object.keys(flow.scopes)
          .filter((s) => s.length > 0 && s.length <= MAX_STRING_CHARS)
          .slice(0, MAX_SCOPES);
        if (scopes.length > 0) oauth.scopesSupported = scopes;
      }
    }
    return Object.keys(oauth).length > 0 ? { status: 'oauth2', oauth } : { status: 'oauth2' };
  }

  const hasKeyOrBearer = values.some(
    (s) =>
      s.type === 'apiKey' || (s.type === 'http' && (s.scheme === 'bearer' || s.scheme === 'basic')),
  );
  return { status: hasKeyOrBearer ? 'api_key' : 'none' };
}
