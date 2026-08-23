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
  | 'markdown-twins'
  | 'robots.txt'
  | 'sitemap'
  | 'agents.md'
  | 'json-ld'
  | 'openapi.json'
  | 'mcp-server'
  | 'auth.md';

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
  // Ora's probe fetches the homepage's .md fallback and checks the agreed frontmatter keys — both
  // are exactly what the markdown-twin pass produces, so the twin state answers these checks.
  { artifact: 'markdown-twins', checks: ['markdown-url-fallback', 'markdown-frontmatter'] },
  { artifact: 'robots.txt', checks: ['robots-ai-policy-quality'] },
  { artifact: 'sitemap', checks: ['sitemap'] },
  { artifact: 'agents.md', checks: ['agent-instruction'] },
  { artifact: 'json-ld', checks: ['json-ld', 'org-schema-completeness'] },
  { artifact: 'openapi.json', checks: ['openapi-spec'] },
  { artifact: 'mcp-server', checks: ['mcp-server', 'mcp-server-card'] },
  // The generated gated-surface guide. Only emitted when the site actually has gated surfaces —
  // with nothing gated, the caller marks it 'not-applicable' and the checks are omitted entirely
  // (an absent check is "this build can't speak to it", never a claim the site fails it).
  { artifact: 'auth.md', checks: ['auth-md-exists', 'auth-md-structure'] },
  // No 'webmcp' entry for now: WebMCP is still a W3C draft, and steering a coding agent toward a
  // non-official spec confuses more than it helps — until it is official we don't recommend it,
  // so the report carries no check for it. Re-add `{ artifact: 'webmcp', checks: ['webmcp'] }`
  // when the spec lands.
];

/**
 * Whether each mapped artifact was found (or generated) during this build. `'not-applicable'`
 * omits the artifact's checks from the report entirely — for checks that only exist when the site
 * has the underlying surface at all (auth.md with no gated surfaces, a homepage markdown fallback
 * on a site with no page routes).
 */
export type OraArtifactPresence = Record<OraArtifact, boolean | 'not-applicable'>;

/**
 * Expands the artifact map into a flat, per-check list: `addressed` for every check whose artifact
 * this build has, `actionable` for the rest, nothing at all for `'not-applicable'` artifacts.
 * `notes` attaches a per-artifact next step (e.g. "the component was scaffolded, now import it")
 * to that artifact's checks — a note never changes a check's state, it only explains an
 * `actionable` one that isn't simply "missing".
 */
export function buildOraChecks(
  present: OraArtifactPresence,
  notes: Partial<Record<OraArtifact, string>> = {},
): OraCheckStatus[] {
  return ORA_CHECK_MAP.flatMap(({ artifact, checks }) => {
    if (present[artifact] === 'not-applicable') return [];
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
