import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findAppDir, listDynamicRoutePrefixes } from '../src/app-dir.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-app-dir-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('findAppDir', () => {
  it('finds a root app/ directory', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    expect(findAppDir(dir)).toBe(join(dir, 'app'));
  });

  it('finds a src/app/ directory when root app/ is absent', () => {
    mkdirSync(join(dir, 'src', 'app'), { recursive: true });
    expect(findAppDir(dir)).toBe(join(dir, 'src', 'app'));
  });

  it('prefers root app/ over src/app/ when both exist', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    mkdirSync(join(dir, 'src', 'app'), { recursive: true });
    expect(findAppDir(dir)).toBe(join(dir, 'app'));
  });

  it('returns undefined when neither exists', () => {
    expect(findAppDir(dir)).toBeUndefined();
  });
});

describe('listDynamicRoutePrefixes', () => {
  function page(relDir: string): void {
    const abs = join(dir, 'app', relDir);
    mkdirSync(abs, { recursive: true });
    writeFileSync(join(abs, 'page.tsx'), 'export default () => null;', 'utf8');
  }

  it('records the static prefix of each dynamic route, through route groups', () => {
    page('blog/[slug]');
    page('(marketing)/docs/[...path]');
    page('shop/[category]/[item]'); // one prefix per route, at the first dynamic segment
    expect(listDynamicRoutePrefixes(join(dir, 'app'))).toEqual(['/blog', '/docs', '/shop']);
  });

  it('maps a root-level dynamic segment to /', () => {
    page('[locale]');
    expect(listDynamicRoutePrefixes(join(dir, 'app'))).toEqual(['/']);
  });

  it('ignores static, parallel, private, and intercepting routes', () => {
    page('docs');
    page('@modal/photo/[id]');
    page('_internal/[id]');
    page('feed/(.)photo/[id]');
    expect(listDynamicRoutePrefixes(join(dir, 'app'))).toEqual([]);
  });
});
