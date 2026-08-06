// TypeScript mirror of the AI Catalog spec (see spec/ai-catalog.md). These types describe a
// *valid* catalog; validateCatalog() remains the runtime oracle. Unknown properties are permitted
// by the spec, hence the index signatures on the open objects.

/** Custom/vendor metadata — any JSON value, keyed by string (reverse-DNS prefixes recommended). */
export type CatalogMetadata = Record<string, unknown>;

/** Verifiable identity/trust metadata. Out of scope for v1 emission; typed loosely. */
export type TrustManifest = Record<string, unknown>;

/**
 * The auth posture of an entry's surface. Deliberately the exact shape Ora's registry projects and
 * re-validates (`EntryAuthStatus` in ora's `src/lib/ard/`): a value outside these four is dropped
 * on crawl, so ax emits only these.
 */
export type EntryAuthStatus = 'oauth2' | 'api_key' | 'none' | 'unknown';

/** Concrete OAuth 2 facts for an entry, populated from a declared/detected auth surface. */
export interface EntryAuthOAuth {
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  /** RFC 7591 Dynamic Client Registration endpoint, when advertised. */
  registrationEndpoint?: string;
  scopesSupported?: string[];
  grantTypesSupported?: string[];
  /** True when a dynamic client registration endpoint was found. */
  dcr?: boolean;
}

/**
 * A secret-free auth descriptor on a catalog entry. A genuine ARD *extension* field (entries allow
 * unknown keys; the manifest root/host do not), mirroring the shape registries read — only
 * structural facts (status, endpoint URLs, scope keys) ever appear here, never secrets or prose.
 */
export interface EntryAuth {
  status: EntryAuthStatus;
  oauth?: EntryAuthOAuth;
  /** Human-readable auth documentation URL, when one is known. Must be http(s). */
  docsUrl?: string;
}

export interface CatalogHost {
  displayName: string;
  identifier?: string;
  documentationUrl?: string;
  logoUrl?: string;
  trustManifest?: TrustManifest;
  [key: string]: unknown;
}

export interface CatalogPublisher {
  identifier: string;
  displayName: string;
  identityType?: string;
  [key: string]: unknown;
}

interface CatalogEntryBase {
  /** Unique artifact ID. ARD requires `urn:air:<publisher-domain>:<name>` (enforced at emission). */
  identifier: string;
  /** Media type identifier. Open string, not an enum. */
  type: string;
  /** Optional in the base spec, but required by the ARD schema on every emitted entry. */
  displayName?: string;
  description?: string;
  tags?: string[];
  version?: string;
  publisher?: CatalogPublisher;
  trustManifest?: TrustManifest;
  /** ISO 8601 last-modification timestamp. */
  updatedAt?: string;
  /** Secret-free auth descriptor for a gated surface (ARD extension field). */
  auth?: EntryAuth;
  metadata?: CatalogMetadata;
  [key: string]: unknown;
}

/** An entry must carry exactly one of `url` or `data`. */
export type CatalogEntry =
  | (CatalogEntryBase & { url: string; data?: never })
  | (CatalogEntryBase & { data: unknown; url?: never });

export interface AiCatalog {
  /** Major.Minor, e.g. "1.0". */
  specVersion: string;
  entries: CatalogEntry[];
  host?: CatalogHost;
  metadata?: CatalogMetadata;
  [key: string]: unknown;
}
