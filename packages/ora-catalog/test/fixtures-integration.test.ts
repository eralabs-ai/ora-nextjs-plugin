import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateCatalog } from '../src/generate.js';
import { validateCatalog } from '../src/validate.js';

const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

// Regression guard for the Phase 1 walking-skeleton wiring: generation against the real fixture
// corpus (not just synthetic tmp dirs) must stay spec-valid. Doesn't write files — that's covered
// by write.test.ts — just exercises generateCatalog against real package.json shapes.
describe('generateCatalog against the fixture corpus', () => {
  it.each(['bare', 'bare-js', 'deploy-variants'])(
    'produces a spec-valid catalog for %s',
    (name) => {
      const catalog = generateCatalog({ cwd: `${fixturesDir}${name}` });
      expect(validateCatalog(catalog).valid).toBe(true);
      expect(catalog.host?.displayName).toBeTruthy();
    },
  );
});
