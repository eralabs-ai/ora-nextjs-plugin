// Hand-written JSON Schema for `ax.config.*`, validated through the same Ajv instance as the AI
// Catalog spec itself (see ajv-instance.ts) — one schema-validation library for the whole package.
// This schema is this package's own contract, not the vendored spec, so it lives here rather than
// in spec/.

import type { IsGated } from './gating.js';

/** One entry the developer declares by hand, merged over/appended to inferred entries. */
export interface AxEntryOverride {
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
  // Entries also remain an open extension point (auth, top-level provenance, ...). Config
  // overrides mirror that.
  [key: string]: unknown;
}

export interface AxConfig {
  /**
   * The site's absolute production URL (e.g. `https://example.com`, no trailing slash). Zero-config
   * detectors (MCP/OpenAPI/llms.txt) need this to build the absolute `url` the spec's
   * schema requires for every referenced artifact; without it (and without Vercel's build-time
   * `VERCEL_PROJECT_PRODUCTION_URL`), those detectors still run but skip emitting a URL-bearing entry
   * rather than guess or emit an invalid one — set this explicitly on non-Vercel hosts.
   */
  siteUrl?: string;
  /**
   * Where to emit the catalog. Defaults to `'static'`.
   *
   * - `'static'` — write `public/.well-known/ai-catalog.json`. Simplest, but served under any
   *   `next.config` `basePath` prefix, not at the domain root crawlers expect.
   * - `'route'` — write an App Router route handler at `app/.well-known/ai-catalog.json/route.{ts,js}`
   *   (`force-static`, `Content-Type: application/json`). The path for proxy setups and the future
   *   path to dynamic catalogs. Note: a route handler is *also* subject to `basePath`, so on a
   *   `basePath` app the true fix is the `<link rel="ai-catalog">` / robots `Agentmap:` pointer this
   *   plugin recommends (ARD §6.1) — see the build output.
   */
  emit?: 'static' | 'route';
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
   * Whether to scaffold an agent-aware 404 page (`app/not-found.tsx`) when none exists, plus a
   * route-manifest data module (`app/not-found-agent-data.*`) that is regenerated on every build.
   * The page tells agents why the 404 happened and how to continue (discovery links + the app's
   * real routes); the not-found file itself is scaffolded once and never overwritten. **Opt-in —
   * defaults to `false`**, same reasoning as `scaffoldLlmsTxt`.
   */
  scaffoldAgent404?: boolean;
  /**
   * Whether to manage `public/robots.txt`. When on, ax appends the discovery pointers it is
   * uniquely placed to know — a `Sitemap:` line (only when a sitemap actually exists) and an
   * `Agentmap:` line for the catalog it just generated — to an existing `public/robots.txt`, in a
   * clearly marked block and only when they're missing; or, when the project has no robots source
   * at all, writes one with explicit `Allow` rules for reputable AI crawlers. An existing
   * `app/robots.ts` route handler is never touched. Which crawlers to *block* stays the site
   * owner's decision — the scaffold only shows how, commented out. **Opt-in — defaults to
   * `false`**, same reasoning as `scaffoldLlmsTxt`.
   */
  scaffoldRobots?: boolean;
  /**
   * Whether to scaffold an `app/organization-json-ld.tsx` server component (schema.org
   * `Organization`, built from `package.json` and the resolved site URL) when no JSON-LD is
   * rendered anywhere. Written once, never overwritten, and never wired into your `layout.tsx` by
   * ax — the CLI prints the exact import and element to add instead. **Opt-in — defaults to
   * `false`**, same reasoning as `scaffoldLlmsTxt`.
   */
  scaffoldJsonLd?: boolean;
  /**
   * Marks an artifact (MCP server, OpenAPI/REST surface, or a config-declared entry) as gated
   * behind auth. Supersedes the old `denylist`/`allowlist` pair: a single matcher subsumes both
   * (return `false` to re-include a path the built-in floor would gate). A gated artifact is never
   * advertised as an *open* surface — one ax can describe (a detected `withMcpAuth` /
   * `securitySchemes`) is emitted with a secret-free `auth` descriptor; one it can't describe is
   * dropped rather than published. With no `isGated`, a built-in floor gates `/api/auth/**` and
   * `/api/webhooks/**` (see {@link import('./gating.js').defaultIsGated}); supplying `isGated`
   * replaces that floor wholesale, so call `defaultIsGated` from your own matcher to keep it.
   *
   * A function, so it is validated at load time by a `typeof` check rather than the JSON Schema
   * (which has no function type) — see validate-config.ts.
   */
  isGated?: IsGated;
  /**
   * Write a machine-readable build report — everything the run detected, referenced, warned about,
   * and recommended — so a coding agent or CI step can read one JSON file instead of parsing log
   * lines. `true` writes `.ora/report.json` (project-root-relative, not `public/` — it's build
   * output, never a published artifact); a string writes to that path instead. **Opt-in — defaults
   * to `false`.** The CLI's `--report[=path]` flag overrides this per run.
   */
  report?: boolean | string;
  /** Hand-declared entries that override (by matching `identifier`) or extend the inferred set. */
  entries?: AxEntryOverride[];
}

/**
 * Config with every optional field defaulted — what loaders hand back to the rest of the CLI.
 * `siteUrl` is the one exception: there is no meaningful default for "unknown", so it stays
 * optional even here (undefined means "no absolute site URL could be determined").
 */
export type ResolvedAxConfig = Required<Omit<AxConfig, 'siteUrl' | 'isGated'>> &
  Pick<AxConfig, 'siteUrl' | 'isGated'>;

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
  // Open extensibility, matching the spec's own entries — see AxEntryOverride above.
  additionalProperties: true,
};

export const axConfigSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/eralabs-ai/ora-nextjs-plugin/schema/ax.config.schema.json',
  title: 'AxConfig',
  type: 'object',
  properties: {
    siteUrl: {
      type: 'string',
      format: 'uri',
      // Must be an absolute http(s) origin — the detectors resolve every artifact URL against it.
      pattern: '^https?://',
    },
    emit: { type: 'string', enum: ['static', 'route'] },
    scaffoldLlmsTxt: { type: 'boolean' },
    scaffoldAgent404: { type: 'boolean' },
    scaffoldRobots: { type: 'boolean' },
    scaffoldJsonLd: { type: 'boolean' },
    report: { anyOf: [{ type: 'boolean' }, { type: 'string', minLength: 1 }] },
    entries: { type: 'array', items: entryOverrideSchema },
  },
  // Unlike entries, the top-level config shape is closed — an unrecognized key is almost always a
  // typo, and this is the "fails loudly" surface this validation exists for. `isGated` is the one
  // legitimate key not listed here: it's a function, which JSON Schema has no type for, so
  // validate-config.ts strips it before Ajv runs and validates it with a `typeof` check instead.
  additionalProperties: false,
};
