import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateCatalog } from '../src/generate.js';
import { SPEC_VERSION } from '../src/schema.js';
import { validateCatalog } from '../src/validate.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-generate-'));
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('generateCatalog', () => {
  it('produces a spec-valid catalog with only site-level host metadata', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', description: 'A demo app.' }),
      'utf8',
    );

    const catalog = generateCatalog({ cwd: dir });

    expect(catalog.specVersion).toBe(SPEC_VERSION);
    expect(catalog.entries).toEqual([]);
    expect(catalog.host).toMatchObject({ displayName: 'demo', description: 'A demo app.' });
    expect(validateCatalog(catalog).valid).toBe(true);
  });

  it('never emits entries in Phase 1 — site metadata only, no artifact detection yet', () => {
    const catalog = generateCatalog({ cwd: dir });
    expect(catalog.entries).toEqual([]);
  });

  it('sets host.identifier from the Vercel production domain when present', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'example.com';
    const catalog = generateCatalog({ cwd: dir });
    expect(catalog.host?.identifier).toBe('did:web:example.com');
  });

  it('omits host.identifier when no domain is known', () => {
    const catalog = generateCatalog({ cwd: dir });
    expect(catalog.host?.identifier).toBeUndefined();
  });

  it('defaults cwd to process.cwd() when not provided', () => {
    const catalog = generateCatalog();
    expect(validateCatalog(catalog).valid).toBe(true);
  });
});
