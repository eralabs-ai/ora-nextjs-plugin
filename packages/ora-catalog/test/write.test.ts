import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  it('gates on the strict ARD schema, not just the permissive base one', () => {
    // Base-valid but ARD-invalid: the identifier is not urn:air and displayName is missing.
    const ardInvalid: AiCatalog = {
      specVersion: '1.0',
      host: { displayName: 'Demo' },
      entries: [{ identifier: 'urn:x', type: 'application/json', url: 'https://x.dev' }],
    };
    const result = writeCatalog(dir, ardInvalid);

    if (result.ok) throw new Error('expected the ARD gate to fail');
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

  it("defaults to the 'static' target", () => {
    const result = writeCatalog(dir, validCatalog);
    if (!result.ok) throw new Error('expected a successful write');
    expect(result.target).toBe('static');
  });
});

describe("writeCatalog — 'route' emission target", () => {
  it('writes a route handler at app/.well-known/ai-catalog.json/route.ts embedding the catalog', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');

    const result = writeCatalog(dir, validCatalog, { target: 'route' });

    if (!result.ok) throw new Error('expected a successful write');
    expect(result.target).toBe('route');
    const expectedPath = join(dir, 'app', '.well-known', 'ai-catalog.json', 'route.ts');
    expect(result.path).toBe(expectedPath);

    const source = readFileSync(expectedPath, 'utf8');
    expect(source).toContain("export const dynamic = 'force-static'");
    expect(source).toContain('export function GET(): Response {');
    // The embedded body round-trips back to the exact catalog.
    const bodyLiteral = /const body = (".*");/s.exec(source)?.[1];
    if (bodyLiteral === undefined) throw new Error('expected an embedded body literal');
    expect(JSON.parse(JSON.parse(bodyLiteral))).toEqual(validCatalog);
    // The static file was NOT written when targeting the route.
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('writes route.js (no type annotation) when there is no tsconfig.json', () => {
    mkdirSync(join(dir, 'src', 'app'), { recursive: true });

    const result = writeCatalog(dir, validCatalog, { target: 'route' });

    if (!result.ok) throw new Error('expected a successful write');
    const expectedPath = join(dir, 'src', 'app', '.well-known', 'ai-catalog.json', 'route.js');
    expect(result.path).toBe(expectedPath);
    const source = readFileSync(expectedPath, 'utf8');
    expect(source).toContain('export function GET() {');
    expect(source).not.toContain(': Response');
  });

  it('falls back to the static target (with a warning) when there is no app/ directory', () => {
    const warnings: string[] = [];
    const result = writeCatalog(dir, validCatalog, {
      target: 'route',
      warn: (m) => warnings.push(m),
    });

    if (!result.ok) throw new Error('expected a successful write');
    expect(result.target).toBe('static');
    expect(result.path).toBe(join(dir, CATALOG_OUTPUT_PATH));
    expect(warnings.some((w) => w.includes('no App Router directory'))).toBe(true);
  });

  it('still refuses to write an invalid catalog to the route target', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    const invalid = { entries: [] } as unknown as AiCatalog; // missing specVersion

    const result = writeCatalog(dir, invalid, { target: 'route' });

    if (result.ok) throw new Error('expected validation to fail');
    expect(existsSync(join(dir, 'app', '.well-known'))).toBe(false);
  });
});
