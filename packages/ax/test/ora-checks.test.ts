import { describe, expect, it } from 'vitest';

import {
  buildOraChecks,
  ORA_CHECK_MAP,
  ORA_SCAN_API,
  ORA_SKILL_MCP_URL,
  ORA_SKILL_URL,
  type OraArtifact,
  type OraArtifactPresence,
} from '../src/ora-checks.js';

/** Every artifact absent — the starting point for "what does one artifact turn on?" assertions. */
function nothingPresent(): OraArtifactPresence {
  return {
    'ai-catalog.json': false,
    'llms.txt': false,
    'robots.txt': false,
    sitemap: false,
    'agents.md': false,
    'json-ld': false,
    'openapi.json': false,
    'mcp-server': false,
    webmcp: false,
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
      'robots.txt',
      'sitemap',
      'agents.md',
      'json-ld',
      'openapi.json',
      'mcp-server',
      'webmcp',
    ]);
  });

  it('publishes the Ora endpoints an agent needs to close the loop', () => {
    expect(ORA_SKILL_MCP_URL).toBe('https://ora.ai/skill/mcp');
    expect(ORA_SKILL_URL).toBe(
      'https://ora.ai/.well-known/agent-skills/agent-ready-website/SKILL.md',
    );
    expect(ORA_SCAN_API).toEqual({
      scan: 'POST https://ora.ai/api/scan',
      score: 'GET https://ora.ai/api/score/{domain}',
    });
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
    expect(mcpChecks.map((check) => check.id)).toEqual(['mcp-server', 'mcp-server-card']);
    expect(mcpChecks.every((check) => check.status === 'addressed')).toBe(true);
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
