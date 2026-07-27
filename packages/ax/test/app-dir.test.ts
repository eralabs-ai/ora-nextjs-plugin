import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findAppDir } from '../src/app-dir.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-app-dir-'));
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
