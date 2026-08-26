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
describe('generateCatalog build report', () => {
  it('fills in the Ora check mapping without any service URLs', async () => {
    const { report } = await generateCatalog({ cwd: dir });

    expect(report.ora.checks.length).toBeGreaterThan(0);
    // The report describes the site, not a vendor: no skill/scan endpoints are embedded.
    expect(JSON.stringify(report.ora)).not.toContain('ora.ai');
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

    const { serverCardPlan } = await generateCatalog({ cwd: dir });
    expect(serverCardPlan?.multi).toBe(false);
    expect(serverCardPlan?.cards).toHaveLength(1);
    expect(serverCardPlan?.cards[0]).toMatchObject({
      mountPathname: '/mcp',
      serverName: 'mcp',
      primary: true,
    });
    expect(serverCardPlan?.cards[0]?.card).toEqual({
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
    const { serverCardPlan } = await generateCatalog({ cwd: dir });
    expect(serverCardPlan).toBeUndefined();
  });

  it('recommends adding an OpenAPI doc and a JSON-LD block when both are absent', async () => {
    const recommendations: string[] = [];
    await generateCatalog({ cwd: dir, onRecommendation: (m) => recommendations.push(m) });
    const joined = recommendations.join('\n');
    expect(joined).toContain('No OpenAPI doc found');
    expect(joined).toContain('No JSON-LD structured data found');
  });

  it('publishes an isGated-gated MCP mount with an auth marker instead of dropping it', async () => {
    // A gated MCP server's status *is* its description: the entry carries auth.status "unknown"
    // and the card carries authentication.required, so the surface stays discoverable-as-gated —
    // and the written card records the decision for the next build.
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

    const { catalog, serverCardPlan, report } = await generateCatalog({ cwd: dir });

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.auth).toEqual({ status: 'unknown' });
    expect(serverCardPlan?.cards[0]?.card.authentication).toEqual({ required: true });
    // A supplied isGated is a total policy — nothing is ever "unreviewed" under it.
    expect(report.mcp.unreviewedMounts).toEqual([]);
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

  it('reads the committed server card as the gating record (authentication.required → gated)', async () => {
    // The card is the persistence layer: a previous run (ax init or a review-gate answer) recorded
    // "requires auth", so this run publishes the mount as gated without any config and without
    // treating it as unreviewed.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
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
    mkdirSync(join(dir, 'public', '.well-known', 'mcp'), { recursive: true });
    writeFileSync(
      join(dir, 'public', '.well-known', 'mcp', 'server-card.json'),
      JSON.stringify({
        serverUrl: 'https://example.com/mcp',
        authentication: { required: true },
      }),
      'utf8',
    );

    const { catalog, serverCardPlan, report } = await generateCatalog({ cwd: dir });

    expect(catalog.entries[0]?.auth).toEqual({ status: 'unknown' });
    expect(serverCardPlan?.cards[0]?.card.authentication).toEqual({ required: true });
    expect(report.mcp.unreviewedMounts).toEqual([]);
  });

  it('treats a mount as reviewed-public when the committed card lists it without auth', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
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
    mkdirSync(join(dir, 'public', '.well-known', 'mcp'), { recursive: true });
    writeFileSync(
      join(dir, 'public', '.well-known', 'mcp', 'server-card.json'),
      JSON.stringify({ serverUrl: 'https://example.com/mcp' }),
      'utf8',
    );

    const { catalog, serverCardPlan, report } = await generateCatalog({ cwd: dir });

    expect(catalog.entries[0]?.auth).toBeUndefined();
    expect(serverCardPlan?.cards[0]?.card.authentication).toBeUndefined();
    expect(report.mcp.unreviewedMounts).toEqual([]);
  });

  it('lists a mount with no config, no auth wrapper, and no card record as unreviewed', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
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

    const { catalog, report } = await generateCatalog({ cwd: dir });

    // Advertised as open (zero-config default), but flagged for the CLI/report to get a decision.
    expect(report.mcp.unreviewedMounts).toEqual(['/mcp']);
    expect(catalog.entries[0]?.auth).toBeUndefined();
  });

  it('points the mcp catalog entry at the server card, not the raw endpoint', async () => {
    // The entry's type promises card JSON, and the card is the discovery document — so when a card
    // is emitted, the entry references it.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
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

    const { catalog, serverCardPlan } = await generateCatalog({ cwd: dir });

    expect(serverCardPlan?.cards[0]?.card.serverUrl).toBe('https://example.com/mcp');
    expect(catalog.entries[0]?.url).toBe('https://example.com/.well-known/mcp/server-card.json');
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

describe('generateCatalog multi-mount MCP', () => {
  function writeTwoMounts(dir: string): void {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );
    const publicDir = join(dir, 'app', 'api', 'public', 'mcp');
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(
      join(publicDir, 'route.ts'),
      "import { createMcpHandler } from 'mcp-handler';\n" +
        "const handler = createMcpHandler((server) => { server.tool('search', 'd', {}, async () => ({})); });\n" +
        'export { handler as GET };\n',
      'utf8',
    );
    const gatedDir = join(dir, 'app', 'api', 'mcp');
    mkdirSync(gatedDir, { recursive: true });
    writeFileSync(
      join(gatedDir, 'route.ts'),
      "import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n" +
        "const handler = createMcpHandler((server) => { server.tool('pay', 'd', {}, async () => ({})); });\n" +
        'const auth = withMcpAuth(handler, async () => undefined);\n' +
        'export { auth as GET };\n',
      'utf8',
    );
  }

  it('plans one card per mount, public-server primary, and per-card entry URLs', async () => {
    writeTwoMounts(dir);

    const { catalog, serverCardPlan, report } = await generateCatalog({ cwd: dir });

    expect(serverCardPlan?.multi).toBe(true);
    expect(serverCardPlan?.cards.map((c) => c.serverName).sort()).toEqual([
      'api-mcp',
      'api-public-mcp',
    ]);
    // No root card on record, but exactly one PUBLIC server → it is the primary with nothing to
    // review: the root path is probed blind, so the credential-free server is its only sensible
    // owner.
    expect(serverCardPlan?.cards[0]).toMatchObject({
      mountPathname: '/api/public/mcp',
      primary: true,
    });
    expect(report.mcp.primaryMount).toBe('/api/public/mcp');
    expect(report.mcp.primaryUnreviewed).toBeUndefined();
    // The public (unreviewed-gating) mount is listed; the withMcpAuth one is self-reviewed.
    expect(report.mcp.unreviewedMounts).toEqual(['/api/public/mcp']);

    const urls = catalog.entries
      .filter((e) => e.type === 'application/mcp-server-card+json')
      .map((e) => e.url)
      .sort();
    expect(urls).toEqual([
      'https://example.com/.well-known/mcp/server-card.json',
      'https://example.com/.well-known/mcp/server-card/api-mcp.json',
    ]);
  });

  it('flags the primary unreviewed only when several servers are public (ambiguous)', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );
    for (const name of ['alpha', 'beta']) {
      const mountDir = join(dir, 'app', 'api', name, 'mcp');
      mkdirSync(mountDir, { recursive: true });
      writeFileSync(
        join(mountDir, 'route.ts'),
        "import { createMcpHandler } from 'mcp-handler';\n" +
          "const handler = createMcpHandler((server) => { server.tool('t', 'd', {}, async () => ({})); });\n" +
          'export { handler as GET };\n',
        'utf8',
      );
    }

    const { report } = await generateCatalog({ cwd: dir });

    expect(report.mcp.primaryMount).toBe('/api/alpha/mcp');
    expect(report.mcp.primaryUnreviewed).toBe(true);
  });

  it('reads the primary and per-mount gating back from committed root + named cards', async () => {
    writeTwoMounts(dir);
    // Committed cards: the *gated* server owns the root path (a deliberate non-default primary),
    // and the public server's named card records the reviewed-public answer.
    mkdirSync(join(dir, 'public', '.well-known', 'mcp', 'server-card'), { recursive: true });
    writeFileSync(
      join(dir, 'public', '.well-known', 'mcp', 'server-card.json'),
      JSON.stringify({
        serverUrl: 'https://example.com/api/mcp',
        authentication: { required: true },
      }),
      'utf8',
    );
    writeFileSync(
      join(dir, 'public', '.well-known', 'mcp', 'server-card', 'api-public-mcp.json'),
      JSON.stringify({ serverUrl: 'https://example.com/api/public/mcp' }),
      'utf8',
    );

    const { serverCardPlan, report } = await generateCatalog({ cwd: dir });

    expect(report.mcp.primaryMount).toBe('/api/mcp');
    expect(report.mcp.primaryUnreviewed).toBeUndefined();
    expect(report.mcp.unreviewedMounts).toEqual([]);
    expect(serverCardPlan?.cards[0]).toMatchObject({ mountPathname: '/api/mcp', primary: true });
  });

  it('holds the mcp-server-card check actionable (with a note) when mounts exist but no card can be built', async () => {
    // Mounts but no site origin: the mcp-server check is addressed, the card check is not.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "import { createMcpHandler } from 'mcp-handler';\n" +
        "const handler = createMcpHandler((server) => { server.tool('roll_dice', 'd', {}, async () => ({})); });\n" +
        'export { handler as GET };\n',
      'utf8',
    );

    const { serverCardPlan, report } = await generateCatalog({ cwd: dir });

    expect(serverCardPlan).toBeUndefined();
    const serverCheck = report.ora.checks.find((c) => c.id === 'mcp-server');
    const cardCheck = report.ora.checks.find((c) => c.id === 'mcp-server-card');
    expect(serverCheck?.status).toBe('addressed');
    expect(cardCheck?.status).toBe('actionable');
    expect(cardCheck?.note).toContain('no site URL');
  });

  it('omits the mcp-server-card check entirely when there is no MCP mount', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const { report } = await generateCatalog({ cwd: dir });

    expect(report.ora.checks.some((c) => c.id === 'mcp-server-card')).toBe(false);
  });
});

describe('generateCatalog with config-declared entry auth', () => {
  const declaringConfig = [
    'export default {',
    "  siteUrl: 'https://example.com',",
    '  entries: [{',
    "    identifier: 'urn:air:example.com:mcp-server',",
    '    auth: {',
    "      status: 'oauth2',",
    "      oauth: { authorizationEndpoint: 'https://auth.example.com/authorize', tokenEndpoint: 'https://auth.example.com/token' },",
    "      docsUrl: 'https://example.com/docs/auth',",
    '    },',
    '  }],',
    '};',
    '',
  ].join('\n');

  it('refines a withMcpAuth mount everywhere: entry, server card, and auth.md endpoints', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(join(dir, 'ax.config.mjs'), declaringConfig, 'utf8');
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n" +
        'const handler = createMcpHandler((server) => {});\n' +
        'const authed = withMcpAuth(handler, verifyToken, {});\n' +
        'export { authed as GET };\n',
      'utf8',
    );

    const { catalog, serverCardPlan, authMdPlan, report } = await generateCatalog({ cwd: dir });

    // The catalog entry carries the declared descriptor, not the detection ceiling ("unknown").
    expect(catalog.entries[0]?.auth).toEqual({
      status: 'oauth2',
      oauth: {
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
      },
      docsUrl: 'https://example.com/docs/auth',
    });
    expect(serverCardPlan?.cards[0]?.card.authentication).toEqual({ required: true });
    // auth.md now tells agents *how* to authenticate instead of "not statically derivable".
    expect(authMdPlan?.content).toContain('OAuth 2.0');
    expect(authMdPlan?.content).toContain('<https://auth.example.com/token>');
    expect(authMdPlan?.content).toContain('Get access: <https://example.com/docs/auth>');
    expect(authMdPlan?.content).not.toContain('not statically derivable');
    expect(report.mcp.unreviewedMounts).toEqual([]);
  });

  it('gates an un-wrapped mount by declaration alone and marks it reviewed', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(join(dir, 'ax.config.mjs'), declaringConfig, 'utf8');
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "import { createMcpHandler } from 'mcp-handler';\n" +
        'const handler = createMcpHandler((server) => {});\n' +
        'export { handler as GET };\n',
      'utf8',
    );

    const { catalog, serverCardPlan, authMdPlan, report } = await generateCatalog({ cwd: dir });

    expect(catalog.entries[0]?.auth?.status).toBe('oauth2');
    expect(serverCardPlan?.cards[0]?.card.authentication).toEqual({ required: true });
    expect(authMdPlan).toBeDefined();
    // Declaring auth in config *is* the review — the mount is neither unreviewed nor silently open.
    expect(report.mcp.unreviewedMounts).toEqual([]);
  });

  it("warns when a declared status contradicts the surface's own committed declaration", async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      [
        'export default {',
        "  siteUrl: 'https://example.com',",
        "  entries: [{ identifier: 'urn:air:example.com:openapi', auth: { status: 'oauth2' } }],",
        '};',
        '',
      ].join('\n'),
      'utf8',
    );
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(
      join(dir, 'public', 'openapi.json'),
      JSON.stringify({
        openapi: '3.1.0',
        info: {},
        components: { securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-K' } } },
      }),
      'utf8',
    );

    const warnings: string[] = [];
    const { catalog } = await generateCatalog({ cwd: dir, onWarning: (m) => warnings.push(m) });

    expect(catalog.entries[0]?.auth).toEqual({ status: 'oauth2' });
    expect(warnings.some((w) => w.includes('"oauth2"') && w.includes('"api_key"'))).toBe(true);
  });
});
