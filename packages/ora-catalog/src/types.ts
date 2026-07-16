// TypeScript mirror of the AI Catalog spec (see spec/ai-catalog.md). These types describe a
// *valid* catalog; validateCatalog() remains the runtime oracle. Unknown properties are permitted
// by the spec, hence the index signatures on the open objects.

/** Custom/vendor metadata — any JSON value, keyed by string (reverse-DNS prefixes recommended). */
export type CatalogMetadata = Record<string, unknown>;

/** Verifiable identity/trust metadata. Out of scope for v1 emission; typed loosely. */
export type TrustManifest = Record<string, unknown>;

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
  /** Unique artifact ID; URN format recommended. */
  identifier: string;
  /** Media type identifier. Open string, not an enum. */
  type: string;
  displayName?: string;
  description?: string;
  tags?: string[];
  version?: string;
  publisher?: CatalogPublisher;
  trustManifest?: TrustManifest;
  /** ISO 8601 last-modification timestamp. */
  updatedAt?: string;
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
