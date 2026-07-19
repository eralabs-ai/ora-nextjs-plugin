import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadArdConfig, ArdConfigError } from '../src/config.js';
import { DEFAULT_DENYLIST } from '../src/config-schema.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadArdConfig', () => {
  it('defaults denylist/allowlist/entries when no config file exists', async () => {
    const { config, path } = await loadArdConfig(dir);
    expect(path).toBeUndefined();
    expect(config).toEqual({ denylist: [...DEFAULT_DENYLIST], allowlist: [], entries: [] });
  });

  it('loads a CommonJS .js config', async () => {
    writeFileSync(
      join(dir, 'ard.config.js'),
      "module.exports = { allowlist: ['/api/auth/status'] };\n",
      'utf8',
    );
    const { config, path } = await loadArdConfig(dir);
    expect(path).toBe(join(dir, 'ard.config.js'));
    expect(config.allowlist).toEqual(['/api/auth/status']);
    expect(config.denylist).toEqual([...DEFAULT_DENYLIST]);
  });

  it('loads an ESM .mjs config with a default export', async () => {
    writeFileSync(
      join(dir, 'ard.config.mjs'),
      "export default { denylist: ['/internal/**'] };\n",
      'utf8',
    );
    const { config } = await loadArdConfig(dir);
    expect(config.denylist).toEqual(['/internal/**']);
  });

  it('loads a TypeScript .ts config', async () => {
    writeFileSync(
      join(dir, 'ard.config.ts'),
      [
        'interface Config { entries: Array<{ identifier: string; url: string }> }',
        'const config: Config = { entries: [{ identifier: "urn:demo:docs", url: "/docs" }] };',
        'export default config;',
        '',
      ].join('\n'),
      'utf8',
    );
    const { config } = await loadArdConfig(dir);
    expect(config.entries).toEqual([{ identifier: 'urn:demo:docs', url: '/docs' }]);
  });

  it('picks .ts over .js when both exist (declared lookup order)', async () => {
    writeFileSync(join(dir, 'ard.config.ts'), 'export default { allowlist: ["ts"] };\n');
    writeFileSync(join(dir, 'ard.config.js'), 'module.exports = { allowlist: ["js"] };\n');
    const { config, path } = await loadArdConfig(dir);
    expect(path).toBe(join(dir, 'ard.config.ts'));
    expect(config.allowlist).toEqual(['ts']);
  });

  it('throws ArdConfigError with an actionable message on an invalid shape', async () => {
    writeFileSync(
      join(dir, 'ard.config.js'),
      'module.exports = { denylist: "not-an-array" };\n',
      'utf8',
    );
    await expect(loadArdConfig(dir)).rejects.toThrow(ArdConfigError);
    await expect(loadArdConfig(dir)).rejects.toThrow(/denylist/);
  });

  it('throws ArdConfigError on an unrecognized top-level key (typo guard)', async () => {
    writeFileSync(
      join(dir, 'ard.config.js'),
      'module.exports = { denyList: [] };\n', // wrong case
      'utf8',
    );
    await expect(loadArdConfig(dir)).rejects.toThrow(ArdConfigError);
  });

  it('throws ArdConfigError when the config file itself throws while loading', async () => {
    writeFileSync(join(dir, 'ard.config.js'), "throw new Error('boom');\n", 'utf8');
    await expect(loadArdConfig(dir)).rejects.toThrow(ArdConfigError);
  });

  it('never partially applies an invalid config — defaults are all-or-nothing', async () => {
    writeFileSync(
      join(dir, 'ard.config.js'),
      'module.exports = { allowlist: ["/ok"], denylist: 123 };\n',
      'utf8',
    );
    await expect(loadArdConfig(dir)).rejects.toThrow(ArdConfigError);
  });
});
