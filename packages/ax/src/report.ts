import type { ArtifactSize } from './artifact-size.js';
import type { WebMcpToolSite } from './detect-webmcp.js';
import type { OraCheckStatus } from './ora-checks.js';
import type { RouterKind } from './router-model.js';
import type { JsonLdScaffoldResult } from './scaffold-json-ld.js';
import type { RobotsScaffoldResult } from './scaffold-robots.js';
import type { EmissionTarget } from './write.js';

// The machine-readable twin of the CLI's stdout: everything the build detected, referenced,
// warned about, and recommended, in one JSON file a coding agent (or CI step) can read directly
// instead of parsing log lines. The report is *output about the build*, not a published artifact —
// it lands in `.ora/` in the project root, never in `public/`, and is opt-in (`report` in
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
 * How this build's findings map onto Ora's named agent-readiness checks. This is what makes the
 * report a handoff rather than a log — an agent reads `checks` and works the `actionable` ones.
 * Deliberately just the mapping: no service URLs, so the report describes the site, not a vendor.
 */
export interface OraReport {
  /** One entry per Ora check this build can speak to. See ora-checks.ts for the mapping. */
  checks: OraCheckStatus[];
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
    /** Path the well-known server card was written to, when one was emitted. */
    serverCardPath?: string;
    /**
     * Served paths of detected mounts with no gating decision on record (no config `isGated`, no
     * detected auth wrapper, not covered by a previously written server card). Advertised as open
     * this run; an interactive build asks about them at the review gate, and a coding agent reading
     * this report should get a decision recorded (run an interactive build, or gate via `isGated`).
     */
    unreviewedMounts: string[];
  };
  webmcp: {
    /** Distinct, browser-reachable in-page tool names. */
    toolNames: string[];
    sites: WebMcpToolSite[];
  };
  /** Presence of the discovery/access artifacts the plugin detects-and-recommends. */
  artifacts: {
    robotsTxt: ReportArtifact;
    sitemap: ReportArtifact;
    agentsMd: ReportArtifact;
    jsonLd: ReportArtifact;
    llmsTxt: ReportArtifact;
    openapi: ReportArtifact;
  };
  /** Agent-aware 404 status: whether a not-found page exists and whether it signposts agents. */
  agent404: {
    notFoundPresent: boolean;
    agentAware: boolean;
    source?: string;
  };
  /** What the opt-in source-tree scaffolds wrote, appended, or skipped this run. */
  scaffolds: ReportScaffolds;
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
