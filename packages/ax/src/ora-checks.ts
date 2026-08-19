// Ora (ora.ai) scores a site's agent-readiness against a registry of named checks. This module is
// the plugin's translation layer between "what this build found on disk" and "what Ora calls it",
// so `.ora/report.json` speaks Ora's check language and a coding agent can close the loop: read the
// report, act on what's still actionable, re-scan the deployed site.
//
// The mapping mirrors Ora's public check registry as of 2026-07-27 and is intentionally
// conservative. An artifact is listed against a check only when the artifact's *presence* is what
// the check looks for; checks that hinge on judgment about content the plugin can't inspect, and
// checks ax has no build-time signal for at all, are absent rather than guessed at. A check absent
// from this map is not a claim that the site fails it — only that this build can't speak to it.

/**
 * Whether the build already satisfies a check (`addressed`), or the site owner (or their coding
 * agent) still has something to do (`actionable`). Two values on purpose: the report is read by an
 * agent deciding what to work on, and every richer vocabulary collapses to this question anyway.
 */
export type OraCheckState = 'addressed' | 'actionable';

/** One Ora check, and the artifact this build derived its state from. */
export interface OraCheckStatus {
  /** Ora check ID, as it appears in Ora's check registry and in scan results. */
  id: string;
  /** The ax-known artifact the state was derived from — see `ORA_CHECK_MAP`. */
  artifact: OraArtifact;
  status: OraCheckState;
  /**
   * Why a check is still actionable when the plugin already did part of the work — e.g. a scaffold
   * was written but nothing imports it yet. Present only when there's a concrete next step beyond
   * "the artifact is missing".
   */
  note?: string;
}

/** The artifacts ax detects or generates, named as the developer would recognize them. */
export type OraArtifact =
  | 'ai-catalog.json'
  | 'llms.txt'
  | 'robots.txt'
  | 'sitemap'
  | 'agents.md'
  | 'json-ld'
  | 'openapi.json'
  | 'mcp-server'
  | 'webmcp';

export interface OraArtifactChecks {
  artifact: OraArtifact;
  /** Ora check IDs this artifact contributes to. */
  checks: readonly string[];
}

/**
 * Artifact → Ora check IDs. Order is the order checks appear in the report, chosen so the artifacts
 * ax always produces come first and the optional/advanced ones last.
 */
export const ORA_CHECK_MAP: readonly OraArtifactChecks[] = [
  { artifact: 'ai-catalog.json', checks: ['ard-catalog', 'agent-discovery-file'] },
  { artifact: 'llms.txt', checks: ['llms-txt-exists', 'llms-txt-formatting'] },
  { artifact: 'robots.txt', checks: ['robots-ai-policy-quality'] },
  { artifact: 'sitemap', checks: ['sitemap'] },
  { artifact: 'agents.md', checks: ['agent-instruction'] },
  { artifact: 'json-ld', checks: ['json-ld', 'org-schema-completeness'] },
  { artifact: 'openapi.json', checks: ['openapi-spec'] },
  { artifact: 'mcp-server', checks: ['mcp-server', 'mcp-server-card'] },
  { artifact: 'webmcp', checks: ['webmcp'] },
];

/** Whether each mapped artifact was found (or generated) during this build. */
export type OraArtifactPresence = Record<OraArtifact, boolean>;

/**
 * Expands the artifact map into a flat, per-check list: `addressed` for every check whose artifact
 * this build has, `actionable` for the rest. `notes` attaches a per-artifact next step (e.g. "the
 * component was scaffolded, now import it") to that artifact's checks — a note never changes a
 * check's state, it only explains an `actionable` one that isn't simply "missing".
 */
export function buildOraChecks(
  present: OraArtifactPresence,
  notes: Partial<Record<OraArtifact, string>> = {},
): OraCheckStatus[] {
  return ORA_CHECK_MAP.flatMap(({ artifact, checks }) => {
    const status: OraCheckState = present[artifact] ? 'addressed' : 'actionable';
    const note = status === 'actionable' ? notes[artifact] : undefined;
    return checks.map((id) => ({
      id,
      artifact,
      status,
      ...(note !== undefined ? { note } : {}),
    }));
  });
}
