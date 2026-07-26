import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProjectEnv } from '../src/load-project-env.js';

// The happy path (actually loading `.env*`) is exercised against a real Next app; here we pin the
// safety contract: in a directory with no resolvable `@next/env` it must be a silent no-op and must
// never clobber a variable already present in `process.env`.
describe('loadProjectEnv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ora-catalog-load-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('never throws when @next/env cannot be resolved', () => {
    expect(() => loadProjectEnv(dir)).not.toThrow();
  });

  it('leaves an already-set variable untouched', () => {
    process.env.ORA_TEST_LOAD_ENV = 'preset';
    try {
      loadProjectEnv(dir);
      expect(process.env.ORA_TEST_LOAD_ENV).toBe('preset');
    } finally {
      delete process.env.ORA_TEST_LOAD_ENV;
    }
  });
});
