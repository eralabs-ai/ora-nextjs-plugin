import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSiteMetadata } from '../src/site-metadata.js';

let dir: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-site-metadata-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

function writePackageJson(contents: unknown): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(contents), 'utf8');
}

describe('readSiteMetadata', () => {
  it('reads displayName and description from package.json', () => {
    writePackageJson({ name: 'my-site', description: 'A cool site.' });
    expect(readSiteMetadata(dir)).toMatchObject({
      displayName: 'my-site',
      description: 'A cool site.',
    });
  });

  it('strips the npm scope from a scoped package name', () => {
    writePackageJson({ name: '@acme/my-site' });
    expect(readSiteMetadata(dir).displayName).toBe('my-site');
  });

  it('omits description when absent', () => {
    writePackageJson({ name: 'my-site' });
    expect(readSiteMetadata(dir).description).toBeUndefined();
  });

  it('falls back to the directory name when package.json is missing', () => {
    const meta = readSiteMetadata(dir);
    expect(meta.displayName).toBe(dir.split('/').pop());
  });

  it('falls back to the directory name when package.json is malformed', () => {
    writeFileSync(join(dir, 'package.json'), '{ not valid json', 'utf8');
    const meta = readSiteMetadata(dir);
    expect(meta.displayName).toBe(dir.split('/').pop());
  });

  it('falls back when name is not a string', () => {
    writePackageJson({ name: 12345 });
    const meta = readSiteMetadata(dir);
    expect(meta.displayName).toBe(dir.split('/').pop());
  });

  it('reads the production domain from VERCEL_PROJECT_PRODUCTION_URL', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'example.com';
    writePackageJson({ name: 'my-site' });
    expect(readSiteMetadata(dir).domain).toBe('example.com');
  });

  it('falls back to VERCEL_URL when the production url is absent', () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.VERCEL_URL = 'my-site-abc123.vercel.app';
    writePackageJson({ name: 'my-site' });
    expect(readSiteMetadata(dir).domain).toBe('my-site-abc123.vercel.app');
  });

  it('leaves domain undefined outside Vercel', () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    writePackageJson({ name: 'my-site' });
    expect(readSiteMetadata(dir).domain).toBeUndefined();
  });
});
