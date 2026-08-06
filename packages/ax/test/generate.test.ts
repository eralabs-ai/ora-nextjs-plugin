import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateCatalog } from '../src/generate.js';
import { SPEC_VERSION } from '../src/schema.js';
import { validateCatalog, validateCatalogArd } from '../src/validate.js';
import { installFakeNextEnv } from './fake-next-env.js';

let dir: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-generate-'));
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe('generateCatalog', () => {
  it('produces a spec-valid catalog with only site-level host metadata', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', description: 'A demo app.' }),
      'utf8',
    );

    const { catalog } = await generateCatalog({ cwd: dir });

    expect(catalog.specVersion).toBe(SPEC_VERSION);
    expect(catalog.entries).toEqual([]);
    expect(catalog.host).toMatchObject({ displayName: 'demo' });
    // No host.description even though package.json has one — the ARD schema closes the host
    // object, so emitting it would fail the official conformance tool.
    expect(catalog.host).not.toHaveProperty('description');
    expect(validateCatalog(catalog).valid).toBe(true);
    expect(validateCatalogArd(catalog).valid).toBe(true);
  });

  it('emits no entries with zero config — artifact detection happens separately', async () => {
    const { catalog } = await generateCatalog({ cwd: dir });
    expect(catalog.entries).toEqual([]);
  });

  it('resolves siteUrl from a project .env (loaded via the app @next/env in postbuild)', async () => {
    // Regression: the CLI runs as its own process, so without loading `.env*` a
    // NEXT_PUBLIC_SITE_URL declared there was ignored and no URL-bearing entry was emitted.
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# hello\n', 'utf8');
    writeFileSync(
      join(dir, '.env'),
      'NEXT_PUBLIC_SITE_URL=https://from-dotenv.example.com\n',
      'utf8',
    );
    installFakeNextEnv(dir);

    const { catalog } = await generateCatalog({ cwd: dir });

    const llmsTxt = catalog.entries.find((e) => e.url?.endsWith('/llms.txt'));
    expect(llmsTxt?.url).toBe('https://from-dotenv.example.com/llms.txt');
    expect(catalog.host?.identifier).toBe('did:web:from-dotenv.example.com');
  });

  it('sets host.identifier from the Vercel production domain when present', async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'example.com';
    const { catalog } = await generateCatalog({ cwd: dir });
    expect(catalog.host?.identifier).toBe('did:web:example.com');
  });

  it('omits host.identifier when no domain is known', async () => {
    const { catalog } = await generateCatalog({ cwd: dir });
    expect(catalog.host?.identifier).toBeUndefined();
  });

  it('defaults cwd to process.cwd() when not provided', async () => {
    const { catalog } = await generateCatalog();
    expect(validateCatalog(catalog).valid).toBe(true);
  });

  it("resolves emit to 'static' by default and to the configured value otherwise", async () => {
    const asDefault = await generateCatalog({ cwd: dir });
    expect(asDefault.emit).toBe('static');

    writeFileSync(join(dir, 'ax.config.mjs'), "export default { emit: 'route' };\n", 'utf8');
    const asRoute = await generateCatalog({ cwd: dir });
    expect(asRoute.emit).toBe('route');
  });
});

// detect-and-recommend: robots.txt / sitemap.xml / agents.md and the ARD §6.1 discovery
// pointer surface as advisory recommendations, never catalog entries and never build failures.
describe('generateCatalog agent-readiness recommendations', () => {
  it('recommends adding robots.txt / sitemap / agents.md when none are present', async () => {
    const recommendations: string[] = [];
    const { catalog } = await generateCatalog({
      cwd: dir,
      onRecommendation: (m) => recommendations.push(m),
    });

    // Recommendations never become catalog entries.
    expect(catalog.entries).toEqual([]);
    const joined = recommendations.join('\n');
    expect(joined).toContain('No robots.txt found');
    expect(joined).toContain('No sitemap found');
    expect(joined).toContain('No agents.md found');
  });

  it('emits the ARD §6.1 discovery-pointer recommendation only when basePath is set', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );

    const withoutBasePath: string[] = [];
    await generateCatalog({ cwd: dir, onRecommendation: (m) => withoutBasePath.push(m) });
    expect(withoutBasePath.some((r) => r.includes('rel="ai-catalog"'))).toBe(false);

    writeFileSync(join(dir, 'next.config.mjs'), "export default { basePath: '/app' };\n", 'utf8');
    const withBasePath: string[] = [];
    await generateCatalog({ cwd: dir, onRecommendation: (m) => withBasePath.push(m) });
    expect(
      withBasePath.some((r) =>
        r.includes('href="https://example.com/app/.well-known/ai-catalog.json"'),
      ),
    ).toBe(true);
  });
});

// The build report is what a coding agent reads instead of the CLI output, and its `ora` section is
// what makes it actionable: each artifact the plugin knows about, expressed as the Ora checks it
// contributes to.
describe('generateCatalog build report (v2)', () => {
  it('reports version 2 with the Ora handoff section filled in', async () => {
    const { report } = await generateCatalog({ cwd: dir });

    expect(report.reportVersion).toBe(2);
    expect(report.ora.skillMcp).toBe('https://ora.ai/skill/mcp');
    expect(report.ora.skillUrl).toContain('agent-ready-website');
    expect(report.ora.scanApi).toEqual({
      scan: 'POST https://ora.ai/api/scan',
      score: 'GET https://ora.ai/api/score/{domain}',
    });
    expect(report.ora.checks.length).toBeGreaterThan(0);
  });

  it('always addresses the catalog checks — every run produces an ai-catalog.json', async () => {
    const { report } = await generateCatalog({ cwd: dir });

    const catalogChecks = report.ora.checks.filter((c) => c.artifact === 'ai-catalog.json');
    expect(catalogChecks.map((c) => c.id)).toEqual(['ard-catalog', 'agent-discovery-file']);
    expect(catalogChecks.every((c) => c.status === 'addressed')).toBe(true);
  });

  it('marks a check addressed once the artifact it maps to is present', async () => {
    const before = await generateCatalog({ cwd: dir });
    expect(before.report.ora.checks.find((c) => c.id === 'sitemap')?.status).toBe('actionable');

    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'sitemap.ts'), 'export default function s() { return []; }\n');

    const after = await generateCatalog({ cwd: dir });
    expect(after.report.ora.checks.find((c) => c.id === 'sitemap')?.status).toBe('addressed');
  });

  it('reports no scaffold outcomes when every scaffold flag is off (the default)', async () => {
    const { report } = await generateCatalog({ cwd: dir });
    expect(report.scaffolds).toEqual({});
  });

  it('records what the opt-in scaffolds wrote, and why a check is still actionable', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com', scaffoldRobots: true, scaffoldJsonLd: true };\n",
      'utf8',
    );

    const { report } = await generateCatalog({ cwd: dir });

    expect(report.scaffolds.robotsTxt).toMatchObject({
      action: 'created',
      path: join(dir, 'public', 'robots.txt'),
    });
    expect(report.scaffolds.jsonLd).toMatchObject({
      action: 'created',
      path: join(dir, 'app', 'organization-json-ld.tsx'),
    });
    // robots.txt now exists, so its check flips; the JSON-LD component exists but nothing renders
    // it, so its checks stay actionable — with the specific next step rather than "it's missing".
    expect(report.ora.checks.find((c) => c.id === 'robots-ai-policy-quality')?.status).toBe(
      'addressed',
    );
    const jsonLdCheck = report.ora.checks.find((c) => c.id === 'json-ld');
    expect(jsonLdCheck?.status).toBe('actionable');
    expect(jsonLdCheck?.note).toContain('<OrganizationJsonLd />');
  });
});

// End-to-end wiring: generateCatalog() must actually call the zero-config detectors and
// fold their output into `entries`, with `ax.config`'s `siteUrl` resolving the absolute URLs they
// need (see the detect-*.test.ts files for each detector's own behavior in isolation).
describe('generateCatalog zero-config artifact detection', () => {
  it('detects a public/openapi.json using the configured siteUrl', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(
      join(dir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.1.0', info: { title: 'Demo API' } }),
      'utf8',
    );

    const { catalog } = await generateCatalog({ cwd: dir });

    expect(validateCatalog(catalog).valid).toBe(true);
    expect(validateCatalogArd(catalog).valid).toBe(true);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]).toMatchObject({
      identifier: 'urn:air:example.com:openapi',
      url: 'https://example.com/openapi.json',
    });
  });

  it('sets host.identifier from a configured siteUrl even without a Vercel domain', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );

    const { catalog } = await generateCatalog({ cwd: dir });
    expect(catalog.host?.identifier).toBe('did:web:example.com');
  });

  it('never emits a detected entry without a known siteUrl — warns instead', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(
      join(dir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.1.0', info: {} }),
      'utf8',
    );

    const warnings: string[] = [];
    const { catalog } = await generateCatalog({ cwd: dir, onWarning: (m) => warnings.push(m) });

    expect(catalog.entries).toEqual([]);
    expect(warnings.some((w) => w.includes('no site URL is known'))).toBe(true);
  });

  it('builds an MCP server card from a detected mount, honoring the emit target', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', description: 'Demo app', version: '2.0.0' }),
      'utf8',
    );
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => { server.tool('roll_dice', 'd', {}, async () => ({})); });\n` +
        `export { handler as GET };\n`,
      'utf8',
    );

    const { serverCard } = await generateCatalog({ cwd: dir });
    expect(serverCard).toEqual({
      name: 'com.example/demo',
      description: 'Demo app',
      version: '2.0.0',
      serverUrl: 'https://example.com/mcp',
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
      tools: [{ name: 'roll_dice' }],
      serverInfo: { name: 'demo', version: '2.0.0' },
      transport: { type: 'streamable-http', endpoint: 'https://example.com/mcp' },
      capabilities: { tools: {} },
    });
  });

  it('emits no server card when there is no MCP mount', async () => {
    const { serverCard } = await generateCatalog({ cwd: dir });
    expect(serverCard).toBeUndefined();
  });

  it('recommends adding an OpenAPI doc and a JSON-LD block when both are absent', async () => {
    const recommendations: string[] = [];
    await generateCatalog({ cwd: dir, onRecommendation: (m) => recommendations.push(m) });
    const joined = recommendations.join('\n');
    expect(joined).toContain('No OpenAPI doc found');
    expect(joined).toContain('No JSON-LD structured data found');
  });

  it('drops a detected entry that isGated marks gated and ax cannot describe', async () => {
    // A plain MCP mount (no withMcpAuth wrapper) has no derivable auth descriptor, so a gated
    // decision means "don't advertise it as open" → drop, the old denylist behavior, but now on a
    // detected (not just config-declared) entry.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com', isGated: ({ path }) => path === '/mcp' };\n",
      'utf8',
    );
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "import { createMcpHandler } from 'mcp-handler';\n" +
        "const handler = createMcpHandler((server) => { server.tool('roll_dice', 'd', {}, async () => ({})); });\n" +
        'export { handler as GET };\n',
      'utf8',
    );

    const warnings: string[] = [];
    const { catalog } = await generateCatalog({ cwd: dir, onWarning: (m) => warnings.push(m) });

    expect(catalog.entries).toEqual([]);
    expect(warnings.some((w) => w.includes('isGated excluded entry'))).toBe(true);
  });

  it('emits a describable gated entry with an auth descriptor rather than dropping it', async () => {
    // An OpenAPI doc always carries a derived auth descriptor. Marking it gated when its own doc
    // declares no auth (`none`) is a disagreement: the explicit isGated wins (downgrade to
    // "unknown") and the entry is still published — more discoverable than a silent drop.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com', isGated: ({ kind }) => kind === 'openapi' };\n",
      'utf8',
    );
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(
      join(dir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.1.0', info: {} }),
      'utf8',
    );

    const warnings: string[] = [];
    const { catalog } = await generateCatalog({ cwd: dir, onWarning: (m) => warnings.push(m) });

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.auth).toEqual({ status: 'unknown' });
    expect(warnings.some((w) => w.includes('as gated, but its own declaration shows'))).toBe(true);
  });

  it('keeps a gated MCP mount that carries its own auth descriptor (withMcpAuth), not dropped', async () => {
    // A withMcpAuth-wrapped mount is describable (auth.status "unknown"), so even when isGated also
    // marks it, it's published *with* the descriptor rather than dropped — the more-discoverable path.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com', isGated: ({ path }) => path === '/mcp' };\n",
      'utf8',
    );
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n" +
        "const handler = createMcpHandler((server) => { server.tool('roll_dice', 'd', {}, async () => ({})); });\n" +
        'const authed = withMcpAuth(handler, verifyToken, {});\n' +
        'export { authed as GET };\n',
      'utf8',
    );

    const { catalog } = await generateCatalog({ cwd: dir });

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.auth).toEqual({ status: 'unknown' });
  });

  it('passes a data-only entry through gating untouched (no URL path to match)', async () => {
    // Entries carrying `data` instead of `url` have no pathname, so isGated can't decide on them —
    // they pass through even when isGated returns true for everything it *can* match.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com', isGated: () => true, " +
        "entries: [{ identifier: 'urn:air:example.com:inline', type: 'application/json', displayName: 'Inline', data: { hello: 'world' } }] };\n",
      'utf8',
    );

    const { catalog } = await generateCatalog({ cwd: dir });

    const entry = catalog.entries.find((e) => e.identifier === 'urn:air:example.com:inline');
    expect(entry).toMatchObject({ data: { hello: 'world' } });
    expect(entry).not.toHaveProperty('auth');
  });

  it('a config-declared override extends a zero-config-detected entry by identifier', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com', entries: [{ identifier: 'urn:air:example.com:openapi', description: 'Hand-written.' }] };\n",
      'utf8',
    );
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(
      join(dir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.1.0', info: { title: 'Demo API' } }),
      'utf8',
    );

    const { catalog } = await generateCatalog({ cwd: dir });

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]).toMatchObject({
      identifier: 'urn:air:example.com:openapi',
      displayName: 'Demo API',
      description: 'Hand-written.',
    });
  });
});
