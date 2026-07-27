import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProjectEnv } from '../src/load-project-env.js';
import { installFakeNextEnv } from './fake-next-env.js';

// Regression coverage for two bugs found in the demo:
//   1. The CLI ran as its own process and never loaded the project's `.env*`, so a
//      NEXT_PUBLIC_SITE_URL in `.env` was silently ignored.
//   2. The first fix used dynamic `import()` on `@next/env`, whose CJS interop buried
//      `loadEnvConfig` under `.default`, so it silently no-op'd. The require-based fix must read
//      `loadEnvConfig` off both the top-level (CommonJS) and `.default` (transpiled-ESM) shapes.

describe('loadProjectEnv', () => {
  let dir: string;
  const TEST_VARS = ['ORA_TEST_SITE_URL', 'ORA_TEST_LOAD_ENV'] as const;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ora-catalog-load-env-'));
    writeFileSync(join(dir, 'package.json'), '{}', 'utf8');
    for (const v of TEST_VARS) delete process.env[v];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const v of TEST_VARS) delete process.env[v];
  });

  it('never throws when @next/env cannot be resolved', () => {
    expect(() => loadProjectEnv(dir)).not.toThrow();
  });

  it('loads .env variables via the project @next/env (CommonJS export)', () => {
    writeFileSync(join(dir, '.env'), 'ORA_TEST_SITE_URL=https://from-dotenv.example.com\n', 'utf8');
    installFakeNextEnv(dir, 'cjs');

    loadProjectEnv(dir);

    expect(process.env.ORA_TEST_SITE_URL).toBe('https://from-dotenv.example.com');
  });

  it('handles a transpiled-ESM shape with loadEnvConfig under .default', () => {
    writeFileSync(join(dir, '.env'), 'ORA_TEST_SITE_URL=https://from-dotenv.example.com\n', 'utf8');
    installFakeNextEnv(dir, 'esm-default');

    loadProjectEnv(dir);

    expect(process.env.ORA_TEST_SITE_URL).toBe('https://from-dotenv.example.com');
  });

  it('does not override a variable already set in process.env', () => {
    process.env.ORA_TEST_LOAD_ENV = 'preset';
    writeFileSync(join(dir, '.env'), 'ORA_TEST_LOAD_ENV=from-dotenv\n', 'utf8');
    installFakeNextEnv(dir, 'cjs');

    loadProjectEnv(dir);

    expect(process.env.ORA_TEST_LOAD_ENV).toBe('preset');
  });
});
