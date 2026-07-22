import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateCatalog } from '../src/generate.js';
import { SPEC_VERSION } from '../src/schema.js';
import { validateCatalog, validateCatalogArd } from '../src/validate.js';

let dir: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-generate-'));
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

  it('emits no entries with zero config — artifact detection is Phase 2.2', async () => {
    const { catalog } = await generateCatalog({ cwd: dir });
    expect(catalog.entries).toEqual([]);
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

    writeFileSync(join(dir, 'ard.config.mjs'), "export default { emit: 'route' };\n", 'utf8');
    const asRoute = await generateCatalog({ cwd: dir });
    expect(asRoute.emit).toBe('route');
  });
});

// detect-and-recommend: robots.txt / sitemap.xml / agents.md and the ARD §6.1 discovery
// pointer surface as advisory recommendations, never catalog entries and never build failures.
describe('generateCatalog agent-readiness recommendations (Phase 2.4)', () => {
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
      join(dir, 'ard.config.mjs'),
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

// Phase 2.2 end-to-end wiring: generateCatalog() must actually call the zero-config detectors and
// fold their output into `entries`, with `ard.config`'s `siteUrl` resolving the absolute URLs they
// need (see the detect-*.test.ts files for each detector's own behavior in isolation).
describe('generateCatalog zero-config artifact detection (Phase 2.2)', () => {
  it('detects a public/openapi.json using the configured siteUrl', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ard.config.mjs'),
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
      join(dir, 'ard.config.mjs'),
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

  it('applies the denylist to a detected entry, not just config-declared ones', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ard.config.mjs'),
      "export default { siteUrl: 'https://example.com', denylist: ['/openapi.json'] };\n",
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

    expect(catalog.entries).toEqual([]);
    expect(warnings.some((w) => w.includes('denylist excluded entry'))).toBe(true);
  });

  it('a config-declared override extends a zero-config-detected entry by identifier', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ard.config.mjs'),
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
