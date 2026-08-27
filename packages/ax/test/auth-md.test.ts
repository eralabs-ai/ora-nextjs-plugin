import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyAuthMdPlan, buildAuthMd } from '../src/auth-md.js';
import { GENERATED_BY } from '../src/markdown-artifact.js';
import type { McpMount } from '../src/detect-mcp.js';
import type { CatalogEntry } from '../src/types.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');

const gatedMount: McpMount = {
  filePath: '/app/api/mcp/route.ts',
  pathname: '/api/mcp',
  capabilities: ['roll_dice'],
  auth: { status: 'unknown' },
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
};

const openMount: McpMount = {
  filePath: '/app/api/open/route.ts',
  pathname: '/api/open',
  capabilities: [],
};

const oauthEntry: CatalogEntry = {
  identifier: 'urn:air:example.com:openapi',
  type: 'application/vnd.oai.openapi+json;version=3.1',
  displayName: 'Acme API',
  url: 'https://example.com/openapi.json',
  auth: {
    status: 'oauth2',
    oauth: {
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      scopesSupported: ['read', 'write'],
    },
    docsUrl: 'https://example.com/docs/auth',
  },
};

function build(mounts: McpMount[], entries: CatalogEntry[]) {
  return buildAuthMd({
    mounts,
    entries,
    siteUrl: 'https://example.com',
    basePath: '',
    siteDisplayName: 'Acme',
    now: NOW,
  });
}

describe('buildAuthMd', () => {
  it('returns undefined when nothing is gated — an empty auth guide is noise', () => {
    expect(build([openMount], [])).toBeUndefined();
  });

  it('describes a gated MCP mount: status, RFC 9728 metadata link, and the docsUrl TODO', () => {
    const plan = build([gatedMount, openMount], []);
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    expect(plan.surfaceCount).toBe(1);
    expect(plan.servedPath).toBe('/auth.md');
    expect(plan.content).toContain('## MCP server at /api/mcp');
    expect(plan.content).toContain('not statically derivable');
    expect(plan.content).toContain('/.well-known/oauth-protected-resource');
    // No docsUrl declared: the "get access" line is the site owner's TODO, not invented prose.
    expect(plan.content).toContain('not documented yet');
    expect(plan.content).toContain(`generated-by: "${GENERATED_BY}"`);
    expect(plan.content).toContain('canonical_url: https://example.com/auth.md');
  });

  it('describes an OpenAPI-declared OAuth surface with its endpoints, scopes, and docsUrl', () => {
    const plan = build([], [oauthEntry]);
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    expect(plan.content).toContain('OAuth 2.0');
    expect(plan.content).toContain('https://auth.example.com/authorize');
    expect(plan.content).toContain('https://auth.example.com/token');
    expect(plan.content).toContain('`read`, `write`');
    expect(plan.content).toContain('<https://example.com/docs/auth>');
  });

  it('never describes an entry that declares itself open', () => {
    const open: CatalogEntry = { ...oauthEntry, auth: { status: 'none' } };
    expect(build([], [open])).toBeUndefined();
  });
});

describe('applyAuthMdPlan', () => {
  let dir: string;
  const warnings: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ax-authmd-'));
    warnings.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the plan to public/auth.md', () => {
    const plan = build([gatedMount], []);
    const result = applyAuthMdPlan(dir, plan, (m) => warnings.push(m));
    expect(result.written).toBe(join('public', 'auth.md'));
    expect(readFileSync(join(dir, 'public', 'auth.md'), 'utf8')).toContain('# Authentication');
  });

  it('removes a previously generated auth.md when nothing is gated anymore', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(
      join(dir, 'public', 'auth.md'),
      `---\ntitle: "Auth"\ngenerated-by: "${GENERATED_BY}"\n---\n\nold\n`,
      'utf8',
    );
    const result = applyAuthMdPlan(dir, undefined, (m) => warnings.push(m));
    expect(result.deleted).toBe(join('public', 'auth.md'));
    expect(existsSync(join(dir, 'public', 'auth.md'))).toBe(false);
  });

  it('never touches a user-authored public/auth.md (no generated-by marker)', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'auth.md'), '# My own auth docs\n', 'utf8');

    // Neither the delete path...
    expect(applyAuthMdPlan(dir, undefined, (m) => warnings.push(m))).toEqual({});
    // ...nor the write path may replace it.
    const result = applyAuthMdPlan(dir, build([gatedMount], []), (m) => warnings.push(m));
    expect(result).toEqual({});
    expect(readFileSync(join(dir, 'public', 'auth.md'), 'utf8')).toBe('# My own auth docs\n');
    expect(warnings.some((w) => w.includes('not generated by ax'))).toBe(true);
  });

  it('says OAuth access is self-service instead of nagging for a docsUrl', () => {
    const plan = buildAuthMd({
      mounts: [
        {
          filePath: 'app/route.ts',
          pathname: '/mcp',
          capabilities: [],
          auth: { status: 'oauth2' },
        },
      ],
      entries: [],
      siteUrl: 'https://example.com',
      basePath: '',
      siteDisplayName: 'demo',
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(plan?.content).toContain('sign in through your MCP client via OAuth');
    expect(plan?.content).not.toContain('not documented yet');
  });
});
