import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AiCatalog } from '../src/types.js';
import { CATALOG_OUTPUT_PATH, writeCatalog } from '../src/write.js';

let dir: string;

const validCatalog: AiCatalog = {
  specVersion: '1.0',
  host: { displayName: 'Demo' },
  entries: [],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-write-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeCatalog', () => {
  it('writes a valid catalog to public/.well-known/ai-catalog.json', () => {
    const result = writeCatalog(dir, validCatalog);

    if (!result.ok) throw new Error('expected a successful write');
    expect(result.path).toBe(join(dir, CATALOG_OUTPUT_PATH));
    const written = JSON.parse(readFileSync(result.path, 'utf8'));
    expect(written).toEqual(validCatalog);
  });

  it('creates public/.well-known/ when it does not exist', () => {
    expect(existsSync(join(dir, 'public'))).toBe(false);
    writeCatalog(dir, validCatalog);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
  });

  it('never writes a file for an invalid catalog (hard-fail gate)', () => {
    const invalid = { entries: [] } as unknown as AiCatalog; // missing specVersion
    const result = writeCatalog(dir, invalid);

    if (result.ok) throw new Error('expected validation to fail');
    expect(result.errors).toBeTruthy();
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('leaves no temp file behind on a successful write', () => {
    writeCatalog(dir, validCatalog);
    const files = readdirSync(join(dir, 'public', '.well-known'));
    expect(files).toEqual(['ai-catalog.json']);
  });

  it('overwrites a previously written catalog', () => {
    writeCatalog(dir, validCatalog);
    const updated: AiCatalog = { ...validCatalog, host: { displayName: 'Updated' } };
    const result = writeCatalog(dir, updated);

    if (!result.ok) throw new Error('expected a successful write');
    const written = JSON.parse(readFileSync(result.path, 'utf8'));
    expect(written.host.displayName).toBe('Updated');
  });
});
