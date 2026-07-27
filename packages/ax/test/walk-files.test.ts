import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pathSegments, walkFiles } from '../src/walk-files.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-walk-files-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function touch(relPath: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, '', 'utf8');
}

describe('walkFiles', () => {
  it('finds matching files at multiple depths', () => {
    touch('route.ts');
    touch('api/mcp/route.ts');
    touch('api/mcp/helpers.ts');

    const found = walkFiles(dir, (name) => name === 'route.ts');
    expect(found.map((f) => f.absolutePath).sort()).toEqual(
      [join(dir, 'route.ts'), join(dir, 'api', 'mcp', 'route.ts')].sort(),
    );
  });

  it('never descends into node_modules', () => {
    touch('node_modules/some-pkg/route.ts');
    touch('route.ts');

    const found = walkFiles(dir, (name) => name === 'route.ts');
    expect(found).toHaveLength(1);
    expect(found[0]?.absolutePath).toBe(join(dir, 'route.ts'));
  });

  it('never descends into hidden directories', () => {
    touch('.git/route.ts');
    touch('route.ts');

    const found = walkFiles(dir, (name) => name === 'route.ts');
    expect(found).toHaveLength(1);
  });

  it('returns an empty array for a root that does not exist', () => {
    expect(walkFiles(join(dir, 'missing'), () => true)).toEqual([]);
  });
});

describe('pathSegments', () => {
  it('splits a relative directory into segments', () => {
    expect(pathSegments(join('api', 'mcp'))).toEqual(['api', 'mcp']);
  });

  it('returns an empty array for the root itself (relative() returns "")', () => {
    expect(pathSegments('')).toEqual([]);
  });
});
