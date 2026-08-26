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

import type { EntryAuth, EntryAuthOAuth, EntryAuthStatus } from './types.js';

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

const ENTRY_AUTH_STATUSES: readonly EntryAuthStatus[] = ['oauth2', 'api_key', 'none', 'unknown'];

// Query-parameter names that mark a URL as carrying a credential rather than pointing at one.
// Declared endpoint/docs URLs are published verbatim in public artifacts, so a `?api_key=…` in one
// is a secret leak the moment the catalog ships — and no legitimate *declared base* URL needs a
// credential parameter (an authorization endpoint takes its parameters at request time).
const CREDENTIAL_QUERY_PARAM_RE =
  /^(api[_-]?key|key|token|access[_-]?token|id[_-]?token|secret|client[_-]?secret|signature|sig|password|auth|bearer|credential)$/i;

/**
 * The name of a credential-looking query parameter embedded in the URL, or undefined when clean.
 * The second half of the secret-guard: {@link safeHttpUrl} keeps non-URLs (a pasted bare token)
 * out of URL fields; this keeps tokens hidden *inside* an otherwise-valid URL out too.
 */
export function credentialQueryParam(url: string): string | undefined {
  try {
    for (const name of new URL(url).searchParams.keys()) {
      if (CREDENTIAL_QUERY_PARAM_RE.test(name)) return name;
    }
  } catch {
    /* not a parseable URL — safeHttpUrl already rejects these */
  }
  return undefined;
}

export interface SanitizeDeclaredAuthResult {
  /** The sanitized descriptor, or undefined when the whole declaration is unusable. */
  auth?: EntryAuth;
  /** One human-readable line per field the sanitizer dropped — for the caller to warn with. */
  dropped: string[];
}

/**
 * Sanitizes a *developer-declared* auth descriptor (an entry override's `auth` in `ax.config`)
 * through the same discipline detection-derived ones get: only the known `EntryAuth` fields cross,
 * URL fields must pass {@link safeHttpUrl}, and lists are capped. The config schema already fails
 * loudly on structural mistakes at load time; this is the belt-and-braces pass at the point of use,
 * so a descriptor that reaches the catalog (and renders as links in auth.md) is secret-free
 * whatever path it arrived by. Dropped fields are reported, never silently swallowed.
 */
export function sanitizeDeclaredAuth(value: unknown): SanitizeDeclaredAuthResult {
  if (!isObject(value)) {
    return { dropped: ['auth is not an object'] };
  }
  const status = value.status;
  if (typeof status !== 'string' || !(ENTRY_AUTH_STATUSES as readonly string[]).includes(status)) {
    return {
      dropped: [
        `auth.status ${JSON.stringify(status)} is not one of ${ENTRY_AUTH_STATUSES.join('/')}`,
      ],
    };
  }

  const dropped: string[] = [];
  const auth: EntryAuth = { status: status as EntryAuthStatus };

  const takeUrl = (raw: unknown, field: string): string | undefined => {
    if (raw === undefined) return undefined;
    const url = safeHttpUrl(raw);
    if (url === undefined) {
      dropped.push(`${field} is not an http(s) URL within ${MAX_STRING_CHARS} chars`);
      return undefined;
    }
    const credentialParam = credentialQueryParam(url);
    if (credentialParam !== undefined) {
      dropped.push(
        `${field} embeds a credential-like query parameter ("${credentialParam}=") — declared ` +
          'URLs are published verbatim in public artifacts, so give a clean URL instead',
      );
      return undefined;
    }
    return url;
  };

  const docsUrl = takeUrl(value.docsUrl, 'auth.docsUrl');
  if (docsUrl !== undefined) auth.docsUrl = docsUrl;

  if (value.oauth !== undefined) {
    if (!isObject(value.oauth)) {
      dropped.push('auth.oauth is not an object');
    } else {
      const raw = value.oauth;
      const oauth: EntryAuthOAuth = {};
      const authorizationEndpoint = takeUrl(
        raw.authorizationEndpoint,
        'auth.oauth.authorizationEndpoint',
      );
      if (authorizationEndpoint !== undefined) oauth.authorizationEndpoint = authorizationEndpoint;
      const tokenEndpoint = takeUrl(raw.tokenEndpoint, 'auth.oauth.tokenEndpoint');
      if (tokenEndpoint !== undefined) oauth.tokenEndpoint = tokenEndpoint;
      const registrationEndpoint = takeUrl(
        raw.registrationEndpoint,
        'auth.oauth.registrationEndpoint',
      );
      if (registrationEndpoint !== undefined) oauth.registrationEndpoint = registrationEndpoint;
      const takeList = (rawList: unknown, field: string): string[] | undefined => {
        if (rawList === undefined) return undefined;
        if (!Array.isArray(rawList)) {
          dropped.push(`${field} is not an array of strings`);
          return undefined;
        }
        const list = rawList
          .filter(
            (s): s is string =>
              typeof s === 'string' && s.length > 0 && s.length <= MAX_STRING_CHARS,
          )
          .slice(0, MAX_SCOPES);
        if (list.length < rawList.length) dropped.push(`${field} entries beyond the caps`);
        return list.length > 0 ? list : undefined;
      };
      const scopesSupported = takeList(raw.scopesSupported, 'auth.oauth.scopesSupported');
      if (scopesSupported !== undefined) oauth.scopesSupported = scopesSupported;
      const grantTypesSupported = takeList(
        raw.grantTypesSupported,
        'auth.oauth.grantTypesSupported',
      );
      if (grantTypesSupported !== undefined) oauth.grantTypesSupported = grantTypesSupported;
      if (typeof raw.dcr === 'boolean') oauth.dcr = raw.dcr;
      else if (raw.dcr !== undefined) dropped.push('auth.oauth.dcr is not a boolean');
      if (Object.keys(oauth).length > 0) auth.oauth = oauth;
    }
  }

  return { auth, dropped };
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
