import type { ArtifactSize } from './artifact-size.js';
import type { DetectedAuthProvider } from './detect-auth-provider.js';
import type { TwinSkipReason, TwinTier } from './markdown-twins.js';
import type { EntryAuthStatus } from './types.js';
import type { OraCheckStatus } from './ora-checks.js';
import type { RouterKind } from './router-model.js';
import type { JsonLdScaffoldResult } from './scaffold-json-ld.js';
import type { RobotsScaffoldResult } from './scaffold-robots.js';
import type { EmissionTarget } from './write.js';

// The machine-readable twin of the CLI's stdout: everything the build detected, referenced,
// warned about, and recommended, in one JSON file a coding agent (or CI step) can read directly
// instead of parsing log lines. The report is *output about the build*, not a published artifact —
// it lands in `.ax/` in the project root, never in `public/`, and is opt-in (`report` in
// ax.config, or the CLI's `--report`).

/** Presence of one detected discovery/access artifact (robots.txt, sitemap, ...). */
export interface ReportArtifact {
  found: boolean;
  /** The detected source path (relative to the project root), if any. */
  source?: string;
}

/**
 * What each opt-in scaffold did this run. A member is present only when its config flag is on, so
 * an absent member means "not asked for", never "tried and failed" — that case is a `skipped`
 * action with a `reason`.
 */
export interface ReportScaffolds {
  /** Path of a starter `app/llms.txt/route.*` written this run. */
  llmsTxt?: { path: string };
  robotsTxt?: RobotsScaffoldResult;
  jsonLd?: JsonLdScaffoldResult;
}

/**
 * What the markdown-twin pass did (and, more importantly, *refused to do and why*): one entry per
 * twin written or already covered by a user-authored source, and one per route skipped with the
 * reason and its next step. The skip list is the actionable half — an agent working the report
 * reads it as "these pages have no markdown representation yet, and here is what would give them
 * one". The terminal only carries counts; the prose lives here.
 */
export interface ReportMarkdownTwins {
  /** `ax.config` `markdownTwins`, resolved (default `true`). */
  enabled: boolean;
  /**
   * Twins written this run: which route, where it landed, and which tier derived it. `source:
   * 'metadata'` marks the lowest-confidence rung — a client-rendered page's twin derived from its
   * own metadata, honest about describing (not mirroring) the page.
   */
  written: Array<{
    route: string;
    path: string;
    tier: TwinTier;
    source: 'mdx' | 'prerender' | 'metadata';
  }>;
  /** Routes already covered by a user-authored markdown source ax never touches. */
  userOwned: Array<{ route: string; source: string }>;
  /** Routes with no twin, each with its reason code and a human-actionable sentence. */
  skipped: Array<{ route: string; reason: TwinSkipReason; detail: string }>;
  /** Count of page files with dynamic URL segments — no statically knowable twin target. */
  dynamicRouteCount: number;
  /** Stale generated twins removed this run (their route no longer exists or qualifies). */
  deleted: string[];
  /** The generated auth guide, when gated surfaces exist. */
  authMd?: { path: string; surfaceCount: number };
}

/**
 * How this build's findings map onto Ora's named agent-readiness checks. This is what makes the
 * report a handoff rather than a log — an agent reads `checks` and works the `actionable` ones.
 * Deliberately just the mapping: no service URLs, so the report describes the site, not a vendor.
 */
export interface OraReport {
  /** One entry per Ora check this build can speak to. See ora-checks.ts for the mapping. */
  checks: OraCheckStatus[];
}

/**
 * The auth posture of the site's agent surfaces, in one structured place — which surfaces are
 * gated and what agents were told about each, plus the detected auth provider with a durable note
 * on what it's worth for agent auth (never version-specific wiring, which would rot). An agent
 * working the report reads each surface's `note` as its next step.
 */
export interface ReportAuth {
  /** One entry per published gated surface, from the same descriptors the catalog carries. */
  gatedSurfaces: Array<{
    /** Served URL path of the gated surface. */
    path: string;
    /** The published scheme (`unknown` = gated but undeclared — the actionable case). */
    status: EntryAuthStatus;
    /** Whether the descriptor came from an ax.config declaration (vs derived from the source). */
    declared: boolean;
    /** Whether OAuth endpoint URLs are published for this surface. */
    oauthEndpoints: boolean;
    /** Where a human obtains access, when declared. */
    docsUrl?: string;
    /** The actionable gap for this surface, when there is one. */
    note?: string;
  }>;
  /** The detected auth-provider dependency, when a known one is present. */
  provider?: DetectedAuthProvider;
}

export interface BuildReport {
  // No version field yet: the shape is still moving and nothing external consumes it until the
  // package is published. Add `reportVersion: 1` at first publish, and bump it only on a change that
  // would break an existing reader.
  /** ISO 8601 timestamp of this run. */
  generatedAt: string;
  /** Resolved site origin, when one was determined (config / env var / Vercel). */
  siteUrl?: string;
  /** `next.config` `basePath`, or `''` when unset. */
  basePath: string;
  /** Which Next.js routers were scanned (`app`, `pages`, or both). Empty for a project with neither. */
  routers: RouterKind[];
  catalog: {
    /** Where the catalog was written — filled in by the CLI after the write succeeds. */
    path?: string;
    target?: EmissionTarget;
    entryCount: number;
    entries: Array<{ identifier: string; type: string; url?: string; displayName?: string }>;
  };
  mcp: {
    /** `mcp-handler` mounts detected in `app/`. */
    mounts: Array<{ pathname: string; tools: string[] }>;
    /** Path the root well-known server card (the primary server's) was written to, when emitted. */
    serverCardPath?: string;
    /** Named per-server cards written for a multi-server host: which mount, and where its card landed. */
    serverCards?: Array<{ mount: string; path: string }>;
    /**
     * The mount whose card owns the root well-known path — present only with several mounts.
     * `primaryUnreviewed` marks a defaulted (public-server) choice with no committed root card
     * confirming it: an interactive build asks, and the next card write records the answer.
     */
    primaryMount?: string;
    primaryUnreviewed?: boolean;
    /**
     * Served paths of detected mounts with no gating decision on record (no config `isGated`, no
     * detected auth wrapper, not covered by a previously written server card). Advertised as open
     * this run; an interactive build asks about them at the review gate, and a coding agent reading
     * this report should get a decision recorded (run an interactive build, or gate via `isGated`).
     */
    unreviewedMounts: string[];
  };
  // No `webmcp` section for now: WebMCP is still a W3C draft, and pointing a coding agent at a
  // non-official spec confuses more than it helps — until it is an official spec we don't
  // recommend it, so the report doesn't surface it. Detection itself still runs (existing in-page
  // tools become catalog entries and CLI notices); re-add the section here when the spec lands.
  /** Presence of the discovery/access artifacts the plugin detects-and-recommends. */
  artifacts: {
    robotsTxt: ReportArtifact;
    sitemap: ReportArtifact;
    agentsMd: ReportArtifact;
    jsonLd: ReportArtifact;
    llmsTxt: ReportArtifact;
    openapi: ReportArtifact;
  };
  /**
   * Agent-aware 404 status. `pages` lists every detected 404 page — App Router `not-found.*`
   * files at the root *and* in route segments (a `notFound()` inside a segment renders the nearest
   * one, bypassing the root), plus the Pages Router's `pages/404.*` — each with whether it links
   * agents onward (the `/404.md` alternate link, llms.txt, or the AI Catalog). `agentAware` is
   * true only when every detected page does. `markdownGuide` is the generated `public/404.md`
   * wayfinding guide, reconciled by the CLI after the write.
   */
  agent404: {
    notFoundPresent: boolean;
    agentAware: boolean;
    pages: Array<{ source: string; agentAware: boolean }>;
    markdownGuide?: string;
  };
  /**
   * The negotiation middleware: whether a `middleware.{ts,js}` exists and whether it wires the
   * `@ora-ai/ax-nextjs/middleware` runtime entry. When it doesn't, the wiring instructions live in the
   * `markdown-negotiation` ora-check note and in `recommendations` — ax never writes or edits the
   * user's middleware singleton.
   */
  middleware: {
    present: boolean;
    wiredToAx: boolean;
    source?: string;
  };
  /** Auth posture of the agent surfaces: gated surfaces, their schemes, the detected provider. */
  auth: ReportAuth;
  /** What the opt-in source-tree scaffolds wrote, appended, or skipped this run. */
  scaffolds: ReportScaffolds;
  /** The markdown-twin pass: what was written, what was refused and why (see the type). */
  markdownTwins: ReportMarkdownTwins;
  /**
   * Byte and estimated-token size of each artifact this build generated. Tokens (`chars / 4`) are
   * the unit that constrains the agent that later reads the artifact; an entry over the truncation
   * limit is the one worth acting on. Populated by the CLI once files are written, so it also
   * records artifacts (the catalog, the server card) the generator returns but does not itself write.
   */
  sizes: ArtifactSize[];
  /** Ora's check language: what's already addressed, what a coding agent should act on. */
  ora: OraReport;
  /** Non-fatal build notices, verbatim as printed. */
  warnings: string[];
  /** Advisory agent-readiness recommendations, verbatim as printed. */
  recommendations: string[];
}
