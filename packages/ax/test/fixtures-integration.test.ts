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
  it.each(['bare', 'bare-js', 'deploy-variants', 'next-auth'])(
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

  it('detects next-auth in the next-auth fixture and steers toward the api_key lane', async () => {
    const { report } = await generateCatalog({ cwd: `${fixturesDir}next-auth` });
    expect(report.auth.provider).toMatchObject({ name: 'next-auth', package: 'next-auth' });
    // The [...nextauth] mount sits under the default /api/auth/** gating floor: never an entry.
    expect(report.auth.provider?.note).toContain('api_key');
  });
});

// End-to-end against the flagship fixture — the demo-app fork that composes most detectors in one
// project: two mcp-handler mounts (one withMcpAuth-gated), a hand-owned llms.txt route, a static
// public/openapi.json, a JSON-LD component rendered from the layout, and a real jiti-loaded
// ax.config.ts declaring the gated entry's auth. `scaffoldLlmsTxt` stays at its default (`false`)
// in generateCatalog runs — fixtures must never gain files as a side effect of this suite.
describe('generateCatalog against the flagship fixture', () => {
  it('detects both mcp-handler mounts with their tools', async () => {
    const { catalog, report } = await generateCatalog({ cwd: `${fixturesDir}flagship` });
    expect(validateCatalogArd(catalog).valid).toBe(true);

    const publicEntry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:flagship-fixture.example.com:mcp-server:api-public-mcp',
    );
    expect(publicEntry).toMatchObject({
      type: 'application/mcp-server-card+json',
      url: 'https://flagship-fixture.example.com/.well-known/mcp/server-card.json',
      capabilities: ['search_flights'],
    });

    const mounts = [...report.mcp.mounts].sort((a, b) => a.pathname.localeCompare(b.pathname));
    expect(mounts).toEqual([
      { pathname: '/api/mcp', tools: ['get_seat_map', 'book_flight', 'pay_booking'] },
      { pathname: '/api/public/mcp', tools: ['search_flights'] },
    ]);
  });

  it('builds a multi-server card plan (public primary, gated named card)', async () => {
    const { serverCardPlan } = await generateCatalog({ cwd: `${fixturesDir}flagship` });
    expect(serverCardPlan?.multi).toBe(true);

    const cards = serverCardPlan?.cards.map((c) => c.card) ?? [];
    const publicCard = cards.find((c) => c.serverUrl?.endsWith('/api/public/mcp'));
    expect(publicCard).toMatchObject({
      name: 'com.example.flagship-fixture/api-public-mcp',
      serverUrl: 'https://flagship-fixture.example.com/api/public/mcp',
      tools: [{ name: 'search_flights' }],
    });
    expect(publicCard?.authentication).toBeUndefined();

    const gatedCard = cards.find((c) => c.serverUrl?.endsWith('/api/mcp'));
    expect(gatedCard?.authentication).toEqual({
      required: true,
      resourceMetadata: 'https://flagship-fixture.example.com/.well-known/oauth-protected-resource',
    });
  });

  it('publishes the config-declared oauth2 descriptor on the gated entry (declared-override path)', async () => {
    // The raw withMcpAuth-without-declaration default (`auth: { status: 'unknown' }`) is proven
    // synthetically in generate.test.ts; the flagship declares the answer in its real ax.config.ts,
    // so this proves the jiti load -> validate -> entry-override pipeline end-to-end.
    const { catalog } = await generateCatalog({ cwd: `${fixturesDir}flagship` });
    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:flagship-fixture.example.com:mcp-server:api-mcp',
    );
    expect(entry).toMatchObject({
      type: 'application/mcp-server-card+json',
      url: 'https://flagship-fixture.example.com/.well-known/mcp/server-card/api-mcp.json',
      capabilities: ['get_seat_map', 'book_flight', 'pay_booking'],
      auth: { status: 'oauth2', docsUrl: 'https://flagship-fixture.example.com/agents.md' },
    });
  });

  it('detects the hand-owned llms.txt route and public/openapi.json', async () => {
    const { catalog } = await generateCatalog({ cwd: `${fixturesDir}flagship` });

    expect(
      catalog.entries.find((e) => e.identifier === 'urn:air:flagship-fixture.example.com:llms-txt'),
    ).toMatchObject({
      type: 'text/markdown',
      url: 'https://flagship-fixture.example.com/llms.txt',
    });
    expect(
      catalog.entries.find((e) => e.identifier === 'urn:air:flagship-fixture.example.com:openapi'),
    ).toMatchObject({
      type: 'application/vnd.oai.openapi+json;version=3.1',
      url: 'https://flagship-fixture.example.com/openapi.json',
    });
  });

  it('detects the JSON-LD component rendered from the flagship layout (recommendation, never an entry)', async () => {
    const recommendations: string[] = [];
    const { catalog } = await generateCatalog({
      cwd: `${fixturesDir}flagship`,
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

  it('never writes into the fixture corpus as a side effect (every scaffold flag defaults to false)', async () => {
    const fixtures = [
      'bare',
      'bare-js',
      'hybrid',
      'flagship',
      'flagship-pages',
      'next-auth',
      'webmcp',
    ];
    for (const name of fixtures) {
      await generateCatalog({ cwd: `${fixturesDir}${name}` });
    }
    // One entry per opt-in scaffold: each writes into the consumer's source tree, so a fixture
    // gaining any of these files means a default flipped to on. Covers both router shapes: the App
    // Router route-handler / component targets and the Pages Router static / `_app` targets.
    // (flagship legitimately owns app/llms.txt and app/organization-json-ld.tsx as committed
    // sources, so for it only the never-scaffolded-elsewhere paths apply.)
    const neverWritten = [
      'public/llms.txt',
      'pages/organization-json-ld.tsx',
      'pages/organization-json-ld.jsx',
    ];
    const neverWrittenUnlessCommitted = [
      'app/llms.txt',
      'app/organization-json-ld.tsx',
      'app/organization-json-ld.jsx',
    ];
    for (const name of fixtures) {
      for (const path of neverWritten) {
        expect(existsSync(`${fixturesDir}${name}/${path}`)).toBe(false);
      }
      if (name === 'flagship') continue;
      for (const path of neverWrittenUnlessCommitted) {
        expect(existsSync(`${fixturesDir}${name}/${path}`)).toBe(false);
      }
    }
  });
});

// Phase 4: WebMCP detection against the real fixture corpus — declarative tools become a
// `text/html` page entry; imperative tools surface via recommendations, never invented entries;
// the edge-cases fixture must warn (server component, deprecated navigator alias) and must not
// detect the user-defined `registerTool` decoy.
describe('generateCatalog WebMCP detection against the fixture corpus', () => {
  it('detects both shapes on one page in the webmcp fixture: declarative entry, imperative recommendation', async () => {
    const recommendations: string[] = [];
    const { catalog, webMcpToolNames } = await generateCatalog({
      cwd: `${fixturesDir}webmcp`,
      onRecommendation: (m) => recommendations.push(m),
    });
    expect(validateCatalogArd(catalog).valid).toBe(true);
    expect([...webMcpToolNames].sort()).toEqual(['add_to_cart', 'subscribe_newsletter']);

    // Exactly one entry: the declarative form's page URL. The imperative registerTool() runs only
    // in the browser, so it is never invented into an entry — only recommended into markup.
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]).toMatchObject({
      identifier: 'urn:air:webmcp-fixture.example.com:webmcp',
      type: 'text/html',
      url: 'https://webmcp-fixture.example.com/',
      capabilities: ['subscribe_newsletter'],
    });
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
// flagship-pages is the flagship's information architecture ported wholesale to the Pages Router,
// so these assertions re-prove the flagship composition against a Pages-only route model.
describe('generateCatalog against the flagship-pages fixture', () => {
  it('produces a spec-valid catalog, reports the pages router, and detects the existing 404', async () => {
    const recommendations: string[] = [];
    const { catalog, report } = await generateCatalog({
      cwd: `${fixturesDir}flagship-pages`,
      onRecommendation: (m) => recommendations.push(m),
    });
    expect(validateCatalog(catalog).valid).toBe(true);
    expect(validateCatalogArd(catalog).valid).toBe(true);
    expect(report.routers).toEqual(['pages']);

    // flagship-pages ships a plain pages/404.tsx: detected, but not agent-aware — so a "link the
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
    // `_app`/`_document`/`404` are special files, `destinations/[slug]` is dynamic — none listed.
    const routes = buildRouterModel(`${fixturesDir}flagship-pages`).listPageRoutes();
    expect(routes).toEqual([
      '/',
      '/account',
      '/checkout',
      '/confirmation',
      '/destinations',
      '/results',
      '/seats',
    ]);
  });

  it('detects both pages/api [transport] MCP mounts (gated + public) with entries and cards', async () => {
    const { catalog, serverCardPlan, report } = await generateCatalog({
      cwd: `${fixturesDir}flagship-pages`,
    });
    expect(validateCatalogArd(catalog).valid).toBe(true);

    const mounts = [...report.mcp.mounts].sort((a, b) => a.pathname.localeCompare(b.pathname));
    expect(mounts).toEqual([
      { pathname: '/api/mcp', tools: ['get_seat_map', 'book_flight', 'pay_booking'] },
      { pathname: '/api/public/mcp', tools: ['search_flights'] },
    ]);

    const gatedEntry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:flagship-pages-fixture.example.com:mcp-server:api-mcp',
    );
    expect(gatedEntry).toMatchObject({
      type: 'application/mcp-server-card+json',
      auth: {
        status: 'oauth2',
        docsUrl: 'https://flagship-pages-fixture.example.com/agents.md',
      },
    });

    expect(serverCardPlan?.multi).toBe(true);
    const cards = serverCardPlan?.cards.map((c) => c.card) ?? [];
    expect(
      cards.find((c) => c.serverUrl === 'https://flagship-pages-fixture.example.com/api/public/mcp')
        ?.tools,
    ).toEqual([{ name: 'search_flights' }]);
  });

  it('attributes the declarative WebMCP form to its Pages Router page URL (catalog entry)', async () => {
    const { catalog, webMcpToolNames, report } = await generateCatalog({
      cwd: `${fixturesDir}flagship-pages`,
    });
    expect(webMcpToolNames).toEqual(['watch_route']);

    // The entry URL is the Pages Router page URL `/destinations` — proving resolveUrlForFile
    // handles the file-is-the-route rule, not just the App Router `page.*` shape.
    const entry = catalog.entries.find(
      (e) => e.identifier === 'urn:air:flagship-pages-fixture.example.com:webmcp:destinations',
    );
    expect(entry).toMatchObject({
      type: 'text/html',
      url: 'https://flagship-pages-fixture.example.com/destinations',
      capabilities: ['watch_route'],
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

// The flagship's serving manifest is the middleware's rewrite contract, so the pieces the dogfood
// relies on must hold from the source tree alone. Assertions stay independent of build state —
// only committed sources are asserted on (generated twins and the catalog artifact appear only
// after a build, so they are deliberately not expected).
describe('the flagship fixture serving manifest', () => {
  it('lists the hand-authored twin, the gated path, the dynamic prefix, and the MDX route', async () => {
    const cwd = join(fixturesDir, 'flagship');
    const { buildServingManifest } = await import('../src/manifest.js');
    const { resolveGating } = await import('../src/gating.js');
    const { loadAxConfig } = await import('../src/config.js');

    const { config } = await loadAxConfig(cwd);
    const nextConfig = await loadNextConfig(cwd);
    const manifest = buildServingManifest({
      cwd,
      router: buildRouterModel(cwd, {
        ...(nextConfig.config.pageExtensions !== undefined
          ? { pageExtensions: nextConfig.config.pageExtensions }
          : {}),
      }),
      isGated: resolveGating(config.isGated),
      basePath: '',
    });

    // /guide is a page.mdx route: it is in the route table exactly because the fixture's
    // next.config pageExtensions serves mdx — the middleware must never treat it as a miss.
    expect(manifest.routes).toEqual([
      '/',
      '/account',
      '/checkout',
      '/confirmation',
      '/destinations',
      '/guide',
      '/results',
      '/seats',
    ]);
    expect(manifest.markdownTwins['/destinations']).toBe('/destinations.md');
    expect(manifest.gatedPaths).toContain('/account');
    expect(manifest.dynamicRoutePrefixes).toEqual(['/destinations']);
  });

  it('wires the middleware, so its negotiation checks read addressed', async () => {
    const { report } = await generateCatalog({ cwd: join(fixturesDir, 'flagship') });
    expect(report.middleware).toMatchObject({ present: true, wiredToAx: true });
    const negotiation = report.ora.checks.filter((check) => check.artifact === 'middleware');
    expect(negotiation.map((check) => check.id).sort()).toEqual([
      'markdown-negotiation',
      'markdown-negotiation-vary',
    ]);
    expect(negotiation.every((check) => check.status === 'addressed')).toBe(true);
  });
});
