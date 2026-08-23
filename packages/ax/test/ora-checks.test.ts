import { describe, expect, it } from 'vitest';

import {
  buildOraChecks,
  ORA_CHECK_MAP,
  type OraArtifact,
  type OraArtifactPresence,
} from '../src/ora-checks.js';

/** Every artifact absent — the starting point for "what does one artifact turn on?" assertions. */
function nothingPresent(): OraArtifactPresence {
  return {
    'ai-catalog.json': false,
    'llms.txt': false,
    'markdown-twins': false,
    'robots.txt': false,
    sitemap: false,
    'agents.md': false,
    'json-ld': false,
    'openapi.json': false,
    'mcp-server': false,
    'mcp-server-card': false,
    'auth.md': false,
  };
}

function idsWithStatus(present: OraArtifactPresence, status: 'addressed' | 'actionable'): string[] {
  return buildOraChecks(present)
    .filter((check) => check.status === status)
    .map((check) => check.id);
}

describe('ORA_CHECK_MAP', () => {
  it('maps every artifact to at least one check, with no duplicated check IDs', () => {
    const ids = ORA_CHECK_MAP.flatMap((entry) => entry.checks);
    expect(ORA_CHECK_MAP.every((entry) => entry.checks.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the artifacts the plugin detects or generates', () => {
    const artifacts = ORA_CHECK_MAP.map((entry) => entry.artifact);
    expect(artifacts).toEqual([
      'ai-catalog.json',
      'llms.txt',
      'markdown-twins',
      'robots.txt',
      'sitemap',
      'agents.md',
      'json-ld',
      'openapi.json',
      'mcp-server',
      'mcp-server-card',
      'auth.md',
    ]);
  });
});

describe('buildOraChecks', () => {
  it('marks every check actionable when the build found nothing', () => {
    const checks = buildOraChecks(nothingPresent());
    expect(checks.every((check) => check.status === 'actionable')).toBe(true);
    expect(checks).toHaveLength(ORA_CHECK_MAP.flatMap((entry) => entry.checks).length);
  });

  it('marks every check addressed when everything is present', () => {
    const present = Object.fromEntries(
      Object.keys(nothingPresent()).map((key) => [key, true]),
    ) as OraArtifactPresence;
    expect(buildOraChecks(present).every((check) => check.status === 'addressed')).toBe(true);
  });

  it('addresses only the checks the present artifact contributes to', () => {
    const present = { ...nothingPresent(), 'llms.txt': true };
    expect(idsWithStatus(present, 'addressed')).toEqual(['llms-txt-exists', 'llms-txt-formatting']);
    expect(idsWithStatus(present, 'actionable')).not.toContain('llms-txt-exists');
  });

  it('carries the artifact each check was derived from, so a fix has an address', () => {
    const present = { ...nothingPresent(), 'mcp-server': true };
    const mcpChecks = buildOraChecks(present).filter((check) => check.artifact === 'mcp-server');
    expect(mcpChecks.map((check) => check.id)).toEqual(['mcp-server']);
    expect(mcpChecks.every((check) => check.status === 'addressed')).toBe(true);
  });

  it('keeps the mcp-server-card check independent of the mount: a mount alone is not a card', () => {
    // The exact drift this split fixes: a detected mount used to mark the card check addressed
    // even when no card was written (several mounts, or no site origin).
    const present = { ...nothingPresent(), 'mcp-server': true };
    const cardChecks = buildOraChecks(present).filter(
      (check) => check.artifact === 'mcp-server-card',
    );
    expect(cardChecks.map((check) => ({ id: check.id, status: check.status }))).toEqual([
      { id: 'mcp-server-card', status: 'actionable' },
    ]);
  });

  it('attaches a note to an actionable artifact, on every check it maps to', () => {
    const notes: Partial<Record<OraArtifact, string>> = { 'json-ld': 'scaffolded, not imported' };
    const checks = buildOraChecks(nothingPresent(), notes).filter(
      (check) => check.artifact === 'json-ld',
    );
    expect(checks).toEqual([
      {
        id: 'json-ld',
        artifact: 'json-ld',
        status: 'actionable',
        note: 'scaffolded, not imported',
      },
      {
        id: 'org-schema-completeness',
        artifact: 'json-ld',
        status: 'actionable',
        note: 'scaffolded, not imported',
      },
    ]);
  });

  it('never attaches a note to an addressed check — there is nothing left to do', () => {
    const present = { ...nothingPresent(), 'json-ld': true };
    const checks = buildOraChecks(present, { 'json-ld': 'stale advice' });
    expect(checks.every((check) => check.note === undefined)).toBe(true);
  });
});

describe("buildOraChecks 'not-applicable' artifacts", () => {
  it('omits a not-applicable artifact’s checks entirely — absent, never actionable', () => {
    const present = { ...nothingPresent(), 'auth.md': 'not-applicable' as const };
    const checks = buildOraChecks(present);
    expect(checks.some((check) => check.artifact === 'auth.md')).toBe(false);
    // The other artifacts are unaffected.
    expect(checks.some((check) => check.id === 'markdown-url-fallback')).toBe(true);
  });

  it('maps the markdown twins and auth guide onto Ora’s real check ids', () => {
    const present = { ...nothingPresent(), 'markdown-twins': true, 'auth.md': true };
    const addressed = buildOraChecks(present)
      .filter((check) => check.status === 'addressed')
      .map((check) => check.id);
    expect(addressed).toEqual([
      'markdown-url-fallback',
      'markdown-frontmatter',
      'auth-md-exists',
      'auth-md-structure',
    ]);
  });
});
