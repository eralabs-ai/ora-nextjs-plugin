import type { WebMcpToolSite } from './detect-webmcp.js';
import type { EmissionTarget } from './write.js';

// The machine-readable twin of the CLI's stdout: everything the build detected, referenced,
// warned about, and recommended, in one JSON file a coding agent (or CI step) can read directly
// instead of parsing log lines. The report is *output about the build*, not a published artifact —
// it lands in `.ora/` in the project root, never in `public/`, and is opt-in (`report` in
// ard.config, or the CLI's `--report`).

/** Presence of one detected discovery/access artifact (robots.txt, sitemap, ...). */
export interface ReportArtifact {
  found: boolean;
  /** The detected source path (relative to the project root), if any. */
  source?: string;
}

export interface BuildReport {
  /** Bumped on breaking shape changes, so readers can gate on it. */
  reportVersion: 1;
  /** ISO 8601 timestamp of this run. */
  generatedAt: string;
  /** Resolved site origin, when one was determined (config / env var / Vercel). */
  siteUrl?: string;
  /** `next.config` `basePath`, or `''` when unset. */
  basePath: string;
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
  /** Non-fatal build notices, verbatim as printed. */
  warnings: string[];
  /** Advisory agent-readiness recommendations, verbatim as printed. */
  recommendations: string[];
}
