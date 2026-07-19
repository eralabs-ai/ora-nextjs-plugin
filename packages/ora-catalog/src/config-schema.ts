// Hand-written JSON Schema for `ora-catalog.config.*`, validated through the same Ajv instance as
// the AI Catalog spec itself (see ajv-instance.ts) — one schema-validation library for the whole
// package. This schema is this package's own contract, not the vendored spec, so it lives here
// rather than in spec/.

/** One entry the developer declares by hand, merged over/appended to inferred entries. */
export interface OraCatalogEntryOverride {
  /** Must match an inferred entry's `identifier` to override/extend it; any other value appends. */
  identifier: string;
  type?: string;
  displayName?: string;
  description?: string;
  url?: string;
  data?: unknown;
  tags?: string[];
  metadata?: Record<string, unknown>;
  // Entries are an intentionally open extension point in the spec (auth, capabilities,
  // provenance, ...) — see PLAN.md "Ground truth from Ora's index". Config overrides mirror that.
  [key: string]: unknown;
}

export interface OraCatalogConfig {
  /**
   * Glob patterns for paths that must never be published, even if some future detector would
   * otherwise infer an entry for them. Default-on: see DEFAULT_DENYLIST.
   */
  denylist?: string[];
  /** Glob patterns that re-include a path the denylist would otherwise exclude. */
  allowlist?: string[];
  /** Hand-declared entries that override (by matching `identifier`) or extend the inferred set. */
  entries?: OraCatalogEntryOverride[];
}

/** Config with every optional field defaulted — what loaders hand back to the rest of the CLI. */
export type ResolvedOraCatalogConfig = Required<OraCatalogConfig>;

/**
 * Default-on denylist (PLAN.md 2.1): auth and webhook routes are never safe to publish
 * unconditionally, so they're excluded even with zero config. `allowlist` re-includes.
 */
export const DEFAULT_DENYLIST: readonly string[] = ['/api/auth/**', '/api/webhooks/**'];

const entryOverrideSchema = {
  type: 'object',
  required: ['identifier'],
  properties: {
    identifier: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    displayName: { type: 'string' },
    description: { type: 'string' },
    url: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    metadata: { type: 'object' },
  },
  // Open extensibility, matching the spec's own entries — see OraCatalogEntryOverride above.
  additionalProperties: true,
};

export const oraCatalogConfigSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/eralabs-ai/ora-nextjs-plugin/schema/ora-catalog.config.schema.json',
  title: 'OraCatalogConfig',
  type: 'object',
  properties: {
    denylist: { type: 'array', items: { type: 'string', minLength: 1 } },
    allowlist: { type: 'array', items: { type: 'string', minLength: 1 } },
    entries: { type: 'array', items: entryOverrideSchema },
  },
  // Unlike entries, the top-level config shape is closed — an unrecognized key is almost always a
  // typo, and this is the "fails loudly" surface PLAN.md 2.1 calls for.
  additionalProperties: false,
};
