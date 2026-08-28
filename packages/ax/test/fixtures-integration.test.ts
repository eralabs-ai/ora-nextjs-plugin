import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateCatalog } from '../src/generate.js';
import { loadNextConfig } from '../src/next-config.js';
import { buildRouterModel } from '../src/router-model.js';
import { validateCatalog, validateCatalogArd } from '../src/validate.js';

const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

// Regression guard for the walking-skeleton wiring: generation against the real fixture
// corpus (not just synthetic tmp dirs) must stay spec-valid. Doesn't write files — that's covered
// by write.test.ts — just exercises generateCatalog against real package.json shapes.
describe('generateCatalog against the fixture corpus', () => {
  it.each(['bare', 'bare-js', 'deploy-variants'])(
    'produces a spec-valid catalog for %s',
    async (name) => {
      const { catalog } = await generateCatalog({ cwd: `${fixturesDir}${name}` });
      expect(validateCatalog(catalog).valid).toBe(true);
      expect(validateCatalogArd(catalog).valid).toBe(true);
      expect(catalog.host?.displayName).toBeTruthy();
    },
  );

  it('warns about basePath for deploy-variants (a known limitation)', async () => {
    const warnings: string[] = [];
    await generateCatalog({
      cwd: `${fixturesDir}deploy-variants`,
      onWarning: (message) => warnings.push(message),
    });
    expect(warnings.some((w) => w.includes('basePath'))).toBe(true);
  });
});

// End-to-end: the config-overrides fixture ships a real `ax.config.ts`, so this
// exercises the whole config path (jiti load -> validate -> entry overrides -> isGated) against a
// committed fixture rather than a synthetic tmp dir.
describe('generateCatalog with the config-overrides fixture', () => {
  it('emits config-declared entries and applies the isGated policy', async () => {
    const { catalog } = await generateCatalog({ cwd: `${fixturesDir}config-overrides` });
    expect(validateCatalog(catalog).valid).toBe(true);
    expect(validateCatalogArd(catalog).valid).toBe(true);

    const ids = catalog.entries.map((entry) => entry.identifier);
    expect(ids).toContain('urn:air:example.com:docs');
    expect(ids).toContain('urn:air:example.com:skills');
    // Gated by the default floor (/api/auth/**) but re-included via the config's isGated matcher.
    expect(ids).toContain('urn:air:example.com:auth-status');
    // Gated and NOT re-included — ax can't describe its auth, so it's dropped though it's declared.
    expect(ids).not.toContain('urn:air:example.com:auth-internal');
  });
});

// End-to-end: each fixture ships a real artifact (an mcp-handler mount, a static
// public/openapi.json, an app/llms.txt/route.ts) plus an ax.config.ts declaring a fixture-specific
// `siteUrl` so the resulting catalog is deterministic in CI. `scaffoldLlmsTxt` stays at its default
// (`false`) here — these fixtures must never gain files as a side effect of running this suite.
describe('generateCatalog zero-config detection against the fixture corpus', () => {
  it('detects the mcp-handler mount in the mcp-adapter fixture', async () => {
    const { catalog } = await generateCatalog({ cwd: `${fixturesDir}mcp-adapter` });
    expect(validateCatalogArd(catalog).valid).toBe(true);

    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:mcp-adapter-fixture.example.com:mcp-server',
    );
    expect(entry).toMatchObject({
      type: 'application/mcp-server-card+json',
      url: 'https://mcp-adapter-fixture.example.com/.well-known/mcp/server-card.json',
      capabilities: ['roll_dice'],
    });
  });

  it('builds a well-known MCP server card from the mcp-adapter fixture mount', async () => {
    const { serverCardPlan } = await generateCatalog({ cwd: `${fixturesDir}mcp-adapter` });
    expect(serverCardPlan?.multi).toBe(false);
    expect(serverCardPlan?.cards[0]?.card).toMatchObject({
      name: 'com.example.mcp-adapter-fixture/mcp-adapter',
      serverUrl: 'https://mcp-adapter-fixture.example.com/mcp',
      remotes: [{ type: 'streamable-http', url: 'https://mcp-adapter-fixture.example.com/mcp' }],
      tools: [{ name: 'roll_dice' }],
    });
  });

  it('marks the gated mcp-adapter-gated mount with auth and a server-card authentication block', async () => {
    const { catalog, serverCardPlan } = await generateCatalog({
      cwd: `${fixturesDir}mcp-adapter-gated`,
    });
    expect(validateCatalogArd(catalog).valid).toBe(true);

    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:mcp-gated-fixture.example.com:mcp-server',
    );
    expect(entry).toMatchObject({
      type: 'application/mcp-server-card+json',
      url: 'https://mcp-gated-fixture.example.com/.well-known/mcp/server-card.json',
      auth: { status: 'unknown' },
    });
    expect(serverCardPlan?.cards[0]?.card.authentication).toEqual({
      required: true,
      resourceMetadata:
        'https://mcp-gated-fixture.example.com/.well-known/oauth-protected-resource',
    });
  });

  it('detects public/openapi.json in the openapi fixture', async () => {
    const { catalog } = await generateCatalog({ cwd: `${fixturesDir}openapi` });
    expect(validateCatalogArd(catalog).valid).toBe(true);

    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:openapi-fixture.example.com:openapi',
    );
    expect(entry).toMatchObject({
      type: 'application/vnd.oai.openapi+json;version=3.1',
      url: 'https://openapi-fixture.example.com/openapi.json',
    });
  });

  it('detects app/llms.txt/route.ts in the llms-txt fixture', async () => {
    const { catalog } = await generateCatalog({ cwd: `${fixturesDir}llms-txt` });
    expect(validateCatalogArd(catalog).valid).toBe(true);

    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:llms-txt-fixture.example.com:llms-txt',
    );
    expect(entry).toMatchObject({
      type: 'text/markdown',
      url: 'https://llms-txt-fixture.example.com/llms.txt',
    });
  });

  it('never writes into the fixture corpus as a side effect (every scaffold flag defaults to false)', async () => {
    const fixtures = [
      'bare',
      'bare-js',
      'mcp-adapter',
      'openapi',
      'pages-bare',
      'pages-mcp',
      'pages-webmcp-declarative',
      'hybrid',
    ];
    for (const name of fixtures) {
      await generateCatalog({ cwd: `${fixturesDir}${name}` });
    }
    // One entry per opt-in scaffold: each writes into the consumer's source tree, so a fixture
    // gaining any of these files means a default flipped to on. Covers both router shapes: the App
    // Router route-handler / component targets and the Pages Router static / `_app` targets.
    const neverWritten = [
      'app/llms.txt',
      'public/llms.txt',
      'public/robots.txt',
      'app/organization-json-ld.tsx',
      'app/organization-json-ld.jsx',
      'pages/organization-json-ld.tsx',
      'pages/organization-json-ld.jsx',
    ];
    for (const name of fixtures) {
      for (const path of neverWritten) {
        expect(existsSync(`${fixturesDir}${name}/${path}`)).toBe(false);
      }
    }
  });
});

// Detect-and-recommend: the discovery fixture ships a JSON-LD Organization block in its
// root layout, so generation must surface the "detected" recommendation (never a catalog entry).
describe('generateCatalog JSON-LD detection against the fixture corpus', () => {
  it('detects the JSON-LD block in the discovery fixture layout', async () => {
    const recommendations: string[] = [];
    const { catalog } = await generateCatalog({
      cwd: `${fixturesDir}discovery`,
      onRecommendation: (m) => recommendations.push(m),
    });
    expect(catalog.entries.every((e) => e.type !== 'application/ld+json')).toBe(true);
    expect(recommendations.some((r) => r.includes('JSON-LD structured data detected'))).toBe(true);
  });

  it('recommends adding JSON-LD for the bare fixture (none present)', async () => {
    const recommendations: string[] = [];
    await generateCatalog({
      cwd: `${fixturesDir}bare`,
      onRecommendation: (m) => recommendations.push(m),
    });
    expect(recommendations.some((r) => r.includes('No JSON-LD structured data found'))).toBe(true);
  });
});

// Phase 4: WebMCP detection against the real fixture corpus — declarative tools become a
// `text/html` page entry; imperative tools surface via recommendations, never invented entries;
// the edge-cases fixture must warn (server component, deprecated navigator alias) and must not
// detect the user-defined `registerTool` decoy.
describe('generateCatalog WebMCP detection against the fixture corpus', () => {
  it('emits a page entry with tool capabilities for the webmcp-declarative fixture', async () => {
    const { catalog, webMcpToolNames } = await generateCatalog({
      cwd: `${fixturesDir}webmcp-declarative`,
    });
    expect(validateCatalogArd(catalog).valid).toBe(true);
    expect(webMcpToolNames).toEqual(['subscribe_newsletter']);

    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:webmcp-declarative-fixture.example.com:webmcp',
    );
    expect(entry).toMatchObject({
      type: 'text/html',
      url: 'https://webmcp-declarative-fixture.example.com/',
      capabilities: ['subscribe_newsletter'],
    });
  });

  it('detects imperative tools in the webmcp-imperative fixture without inventing entries', async () => {
    const recommendations: string[] = [];
    const { catalog, webMcpToolNames } = await generateCatalog({
      cwd: `${fixturesDir}webmcp-imperative`,
      onRecommendation: (m) => recommendations.push(m),
    });
    expect(webMcpToolNames).toEqual(['add_to_cart']);
    expect(catalog.entries).toEqual([]);
    expect(recommendations.some((r) => r.includes('invisible in server-rendered HTML'))).toBe(true);
  });

  it('warns on the edge-cases fixture and ignores the registerTool decoy', async () => {
    const warnings: string[] = [];
    const { webMcpToolNames } = await generateCatalog({
      cwd: `${fixturesDir}edge-cases`,
      onWarning: (m) => warnings.push(m),
    });
    // conditional-tools registers via the deprecated navigator alias in a client component: the
    // tool counts, but the deprecation warning fires. server-register has no 'use client', so its
    // tool must NOT count. The decoy must not be detected at all.
    expect(webMcpToolNames).toEqual(['join_newsletter']);
    expect(warnings.some((w) => w.includes('deprecated'))).toBe(true);
    expect(warnings.some((w) => w.includes("'use client'"))).toBe(true);
    expect(webMcpToolNames).not.toContain('internal-metrics');
    expect(webMcpToolNames).not.toContain('server_side_tool');
  });
});

// Test next-config loading against the deploy-variants and monorepo fixtures.
describe('loadNextConfig against the fixture corpus', () => {
  it('extracts basePath and output from the deploy-variants TypeScript next.config.ts', async () => {
    const result = await loadNextConfig(`${fixturesDir}deploy-variants`);
    expect(result.config).toEqual({ basePath: '/app', output: 'standalone' });
    expect(result.warnings).toEqual([]);
    expect(result.path).toMatch(/next\.config\.ts$/);
  });

  it('loads the monorepo nested app next.config.mjs (empty config -> all defaults)', async () => {
    const result = await loadNextConfig(`${fixturesDir}monorepo/apps/web`);
    expect(result.config).toEqual({});
    expect(result.warnings).toEqual([]);
    expect(result.path).toMatch(/next\.config\.mjs$/);
  });
});

// Pages Router (and hybrid) support: the same detectors run against `pages/` route topology, and a
// project with both routers scans both. Output is still the router-agnostic `public/` catalog.
describe('generateCatalog against the Pages Router fixtures', () => {
  it('produces a spec-valid catalog for pages-bare, reports the pages router, and detects the existing 404', async () => {
    const recommendations: string[] = [];
    const { catalog, report } = await generateCatalog({
      cwd: `${fixturesDir}pages-bare`,
      onRecommendation: (m) => recommendations.push(m),
    });
    expect(validateCatalog(catalog).valid).toBe(true);
    expect(validateCatalogArd(catalog).valid).toBe(true);
    expect(report.routers).toEqual(['pages']);

    // pages-bare ships a plain pages/404.tsx: detected, but not agent-aware — so a "link the
    // wayfinding guide" recommendation, proving the Pages Router 404 convention is recognized
    // (not just app/not-found).
    expect(report.agent404).toMatchObject({
      notFoundPresent: true,
      agentAware: false,
      pages: [{ source: join('pages', '404.tsx'), agentAware: false }],
    });
    expect(recommendations.some((r) => r.includes('doesn’t point agents anywhere'))).toBe(true);
  });

  it('lists Pages Router content routes, excluding special/dynamic/error files', () => {
    // Asserted through the model directly (no scaffold opt-in needed) against the real fixture:
    // `/` and `/about` are content; `_app`/`_document`/`404`/`[slug]` are not.
    const routes = buildRouterModel(`${fixturesDir}pages-bare`).listPageRoutes();
    expect(routes).toEqual(['/', '/about']);
  });

  it('detects the pages/api/[transport].ts MCP mount at /api/mcp (entry, server card, and report)', async () => {
    const recommendations: string[] = [];
    const { catalog, serverCardPlan, report } = await generateCatalog({
      cwd: `${fixturesDir}pages-mcp`,
      onRecommendation: (m) => recommendations.push(m),
    });
    expect(validateCatalogArd(catalog).valid).toBe(true);
    expect(report.routers).toEqual(['pages']);

    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:pages-mcp-fixture.example.com:mcp-server',
    );
    expect(entry).toMatchObject({
      type: 'application/mcp-server-card+json',
      url: 'https://pages-mcp-fixture.example.com/.well-known/mcp/server-card.json',
      capabilities: ['roll_dice'],
    });
    expect(serverCardPlan?.cards[0]?.card).toMatchObject({
      serverUrl: 'https://pages-mcp-fixture.example.com/api/mcp',
      tools: [{ name: 'roll_dice' }],
    });
    // The report mirrors the detection: the mount is surfaced at /api/mcp with its tools.
    expect(report.mcp.mounts).toEqual([{ pathname: '/api/mcp', tools: ['roll_dice'] }]);
    // No pages/404.tsx here — the "add one" recommendation names the Pages Router convention.
    expect(recommendations.some((r) => r.includes('No pages/404.tsx found'))).toBe(true);
  });

  it('attributes a declarative WebMCP form to its Pages Router page URL (catalog entry)', async () => {
    const { catalog, webMcpToolNames, report } = await generateCatalog({
      cwd: `${fixturesDir}pages-webmcp-declarative`,
    });
    expect(validateCatalogArd(catalog).valid).toBe(true);
    expect(webMcpToolNames).toEqual(['subscribe_newsletter']);

    // The entry URL is the Pages Router page URL `/` — proving resolveUrlForFile handles the
    // file-is-the-route rule, not just the App Router `page.*` shape.
    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:pages-webmcp-fixture.example.com:webmcp',
    );
    expect(entry).toMatchObject({
      type: 'text/html',
      url: 'https://pages-webmcp-fixture.example.com/',
      capabilities: ['subscribe_newsletter'],
    });
    // The report carries no webmcp section: the spec is still a draft, so the report doesn't
    // steer agents toward it (see report.ts).
    expect('webmcp' in report).toBe(false);
  });

  it('scans both routers for the hybrid fixture and unions their routes', async () => {
    const { catalog, report } = await generateCatalog({ cwd: `${fixturesDir}hybrid` });
    expect(validateCatalogArd(catalog).valid).toBe(true);
    expect(report.routers).toEqual(['app', 'pages']);

    // `/` and `/dashboard` come from app/, `/about` from pages/ — the union of both routers. A real
    // hybrid app defines each route in only one router (Next.js hard-errors if the same route is in
    // both), so there is no collision to resolve; the plugin just lists each route once.
    const routes = buildRouterModel(`${fixturesDir}hybrid`).listPageRoutes();
    expect(routes).toEqual(['/', '/about', '/dashboard']);
  });
});

// The middleware fixture: the serving manifest its prebuild generates is the middleware's rewrite
// contract, so the pieces the dogfood relies on must hold from the source tree alone. Assertions
// stay independent of build state — only committed sources are asserted on (the generated homepage
// twin and the catalog artifact appear only after a build, so they are deliberately not expected).
describe('the middleware fixture serving manifest', () => {
  it('lists the hand-authored twin, the gated path, and the dynamic prefix', async () => {
    const cwd = join(fixturesDir, 'middleware');
    const { buildServingManifest } = await import('../src/manifest.js');
    const { resolveGating } = await import('../src/gating.js');
    const { loadAxConfig } = await import('../src/config.js');

    const { config } = await loadAxConfig(cwd);
    const manifest = buildServingManifest({
      cwd,
      router: buildRouterModel(cwd),
      isGated: resolveGating(config.isGated),
      basePath: '',
    });

    expect(manifest.routes).toEqual(['/', '/docs', '/private', '/shell']);
    expect(manifest.markdownTwins['/docs']).toBe('/docs.md');
    expect(manifest.gatedPaths).toContain('/private');
    expect(manifest.dynamicRoutePrefixes).toEqual(['/blog']);
  });

  it('wires the middleware, so its negotiation checks read addressed', async () => {
    const { report } = await generateCatalog({ cwd: join(fixturesDir, 'middleware') });
    expect(report.middleware).toMatchObject({ present: true, wiredToAx: true });
    const negotiation = report.ora.checks.filter((check) => check.artifact === 'middleware');
    expect(negotiation.map((check) => check.id).sort()).toEqual([
      'markdown-negotiation',
      'markdown-negotiation-vary',
    ]);
    expect(negotiation.every((check) => check.status === 'addressed')).toBe(true);
  });
});
