import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateCatalog } from '../src/generate.js';
import { SPEC_VERSION } from '../src/schema.js';
import { validateCatalog } from '../src/validate.js';

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

    const catalog = await generateCatalog({ cwd: dir });

    expect(catalog.specVersion).toBe(SPEC_VERSION);
    expect(catalog.entries).toEqual([]);
    expect(catalog.host).toMatchObject({ displayName: 'demo', description: 'A demo app.' });
    expect(validateCatalog(catalog).valid).toBe(true);
  });

  it('emits no entries with zero config — artifact detection is Phase 2.2', async () => {
    const catalog = await generateCatalog({ cwd: dir });
    expect(catalog.entries).toEqual([]);
  });

  it('sets host.identifier from the Vercel production domain when present', async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'example.com';
    const catalog = await generateCatalog({ cwd: dir });
    expect(catalog.host?.identifier).toBe('did:web:example.com');
  });

  it('omits host.identifier when no domain is known', async () => {
    const catalog = await generateCatalog({ cwd: dir });
    expect(catalog.host?.identifier).toBeUndefined();
  });

  it('defaults cwd to process.cwd() when not provided', async () => {
    const catalog = await generateCatalog();
    expect(validateCatalog(catalog).valid).toBe(true);
  });
});
