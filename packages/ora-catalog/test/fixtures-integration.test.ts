import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateCatalog } from '../src/generate.js';
import { loadNextConfig } from '../src/next-config.js';
import { validateCatalog } from '../src/validate.js';

const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

// Regression guard for the Phase 1 walking-skeleton wiring: generation against the real fixture
// corpus (not just synthetic tmp dirs) must stay spec-valid. Doesn't write files — that's covered
// by write.test.ts — just exercises generateCatalog against real package.json shapes.
describe('generateCatalog against the fixture corpus', () => {
  it.each(['bare', 'bare-js', 'deploy-variants'])(
    'produces a spec-valid catalog for %s',
    async (name) => {
      const catalog = await generateCatalog({ cwd: `${fixturesDir}${name}` });
      expect(validateCatalog(catalog).valid).toBe(true);
      expect(catalog.host?.displayName).toBeTruthy();
    },
  );

  it('warns about basePath for deploy-variants (Phase 1 known limitation)', async () => {
    const warnings: string[] = [];
    await generateCatalog({
      cwd: `${fixturesDir}deploy-variants`,
      onWarning: (message) => warnings.push(message),
    });
    expect(warnings.some((w) => w.includes('basePath'))).toBe(true);
  });
});

// Phase 2.1 end-to-end: the config-overrides fixture ships a real `ard.config.ts`, so this
// exercises the whole config path (jiti load -> validate -> entry overrides -> denylist/allowlist)
// against a committed fixture rather than a synthetic tmp dir.
describe('generateCatalog with the config-overrides fixture', () => {
  it('emits config-declared entries and applies denylist + allowlist', async () => {
    const catalog = await generateCatalog({ cwd: `${fixturesDir}config-overrides` });
    expect(validateCatalog(catalog).valid).toBe(true);

    const ids = catalog.entries.map((entry) => entry.identifier);
    expect(ids).toContain('urn:example:docs');
    expect(ids).toContain('urn:example:skills');
    // Denylisted by default (/api/auth/**) but re-included via the config's allowlist.
    expect(ids).toContain('urn:example:auth-status');
    // Denylisted by default and NOT allowlisted — dropped even though the config declares it.
    expect(ids).not.toContain('urn:example:auth-internal');
  });
});

// PLAN.md 2.1: "Test next-config loading against the deploy-variants and monorepo fixtures."
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
