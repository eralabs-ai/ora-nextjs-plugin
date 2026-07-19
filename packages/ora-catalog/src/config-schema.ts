// Hand-written JSON Schema for `ard.config.*`, validated through the same Ajv instance as the AI
// Catalog spec itself (see ajv-instance.ts) — one schema-validation library for the whole package.
// This schema is this package's own contract, not the vendored spec, so it lives here rather than
// in spec/.
//
// The config file is named `ard.config` (Agentic Resource Discovery) rather than after this
// package or Ora: it's a file committed into the consumer's repo, so it stays vendor-neutral (the
// plugin's endgame is upstreaming into Next.js).

/** One entry the developer declares by hand, merged over/appended to inferred entries. */
export interface ArdEntryOverride {
  /**
   * Must match an inferred entry's `identifier` to override/extend it; any other value appends.
   * ARD requires the `urn:air:<publisher-domain>:<name>` format (inferred entries use
   * `urn:air:<siteUrl host>:...`) — a non-conforming identifier fails the emission gate at write
   * time with the schema error.
   */
  identifier: string;
  type?: string;
  /** Required by the ARD schema on every emitted entry — appended entries must declare one. */
  displayName?: string;
  description?: string;
  url?: string;
  data?: unknown;
  tags?: string[];
  /** Tool/skill names for registry-side filtering — a first-class ARD field (spec §4.2). */
  capabilities?: string[];
  /**
   * 2–5 sample natural-language queries — a first-class ARD field (spec §4.2) and the signal
   * registries build semantic search embeddings from, so declaring these directly improves how
   * discoverable the entry is.
   */
  representativeQueries?: string[];
  metadata?: Record<string, unknown>;
  // Entries also remain an open extension point (auth, top-level provenance, ...) — see PLAN.md
  // "Ground truth from Ora's index". Config overrides mirror that.
  [key: string]: unknown;
}

export interface ArdConfig {
  /**
   * The site's absolute production URL (e.g. `https://example.com`, no trailing slash). Zero-config
   * detectors (PLAN.md 2.2 — MCP/OpenAPI/llms.txt) need this to build the absolute `url` the spec's
   * schema requires for every referenced artifact; without it (and without Vercel's build-time
   * `VERCEL_PROJECT_PRODUCTION_URL`), those detectors still run but skip emitting a URL-bearing entry
   * rather than guess or emit an invalid one — set this explicitly on non-Vercel hosts.
   */
  siteUrl?: string;
  /**
   * Whether to scaffold a starter `app/llms.txt/route.ts` (or `.js`) when neither it nor a static
   * `public/llms.txt` exists. Never overwrites an existing file. **Opt-in — defaults to `false`.**
   * Every other part of this plugin only ever writes the one catalog file it's explicitly there to
   * produce; scaffolding a *second* file, into `app/`, is a bigger, unsolicited change to a
   * consumer's source tree, so it requires an explicit `scaffoldLlmsTxt: true` rather than
   * happening silently on every build with zero config.
   */
  scaffoldLlmsTxt?: boolean;
  /**
   * Glob patterns for paths that must never be published, even if some future detector would
   * otherwise infer an entry for them. Default-on: see DEFAULT_DENYLIST.
   */
  denylist?: string[];
  /** Glob patterns that re-include a path the denylist would otherwise exclude. */
  allowlist?: string[];
  /** Hand-declared entries that override (by matching `identifier`) or extend the inferred set. */
  entries?: ArdEntryOverride[];
}

/**
 * Config with every optional field defaulted — what loaders hand back to the rest of the CLI.
 * `siteUrl` is the one exception: there is no meaningful default for "unknown", so it stays
 * optional even here (undefined means "no absolute site URL could be determined").
 */
export type ResolvedArdConfig = Required<Omit<ArdConfig, 'siteUrl'>> & Pick<ArdConfig, 'siteUrl'>;

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
    capabilities: { type: 'array', items: { type: 'string' } },
    // The ARD schema enforces 2–5 items; enforcing it here too surfaces the mistake at config
    // load ("fails loudly") instead of at the write gate.
    representativeQueries: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
    metadata: { type: 'object' },
  },
  // Open extensibility, matching the spec's own entries — see ArdEntryOverride above.
  additionalProperties: true,
};

export const ardConfigSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/eralabs-ai/ora-nextjs-plugin/schema/ard.config.schema.json',
  title: 'ArdConfig',
  type: 'object',
  properties: {
    siteUrl: {
      type: 'string',
      format: 'uri',
      // Must be an absolute http(s) origin — the detectors resolve every artifact URL against it.
      pattern: '^https?://',
    },
    scaffoldLlmsTxt: { type: 'boolean' },
    denylist: { type: 'array', items: { type: 'string', minLength: 1 } },
    allowlist: { type: 'array', items: { type: 'string', minLength: 1 } },
    entries: { type: 'array', items: entryOverrideSchema },
  },
  // Unlike entries, the top-level config shape is closed — an unrecognized key is almost always a
  // typo, and this is the "fails loudly" surface PLAN.md 2.1 calls for.
  additionalProperties: false,
};
