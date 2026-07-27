import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAxConfig, AxConfigError } from '../src/config.js';
import { DEFAULT_DENYLIST } from '../src/config-schema.js';

let dir: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe('loadAxConfig', () => {
  it('defaults denylist/allowlist/entries when no config file exists', async () => {
    const { config, path, warnings } = await loadAxConfig(dir);
    expect(path).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(config).toEqual({
      siteUrl: undefined,
      emit: 'static',
      scaffoldLlmsTxt: false,
      scaffoldAgent404: false,
      scaffoldRobots: false,
      scaffoldJsonLd: false,
      report: false,
      denylist: [...DEFAULT_DENYLIST],
      allowlist: [],
      entries: [],
    });
  });

  it('loads a CommonJS .js config', async () => {
    writeFileSync(
      join(dir, 'ax.config.js'),
      "module.exports = { allowlist: ['/api/auth/status'] };\n",
      'utf8',
    );
    const { config, path } = await loadAxConfig(dir);
    expect(path).toBe(join(dir, 'ax.config.js'));
    expect(config.allowlist).toEqual(['/api/auth/status']);
    expect(config.denylist).toEqual([...DEFAULT_DENYLIST]);
  });

  it('loads an ESM .mjs config with a default export', async () => {
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { denylist: ['/internal/**'] };\n",
      'utf8',
    );
    const { config } = await loadAxConfig(dir);
    expect(config.denylist).toEqual(['/internal/**']);
  });

  it('loads a TypeScript .ts config', async () => {
    writeFileSync(
      join(dir, 'ax.config.ts'),
      [
        'interface Config { entries: Array<{ identifier: string; url: string }> }',
        'const config: Config = { entries: [{ identifier: "urn:demo:docs", url: "/docs" }] };',
        'export default config;',
        '',
      ].join('\n'),
      'utf8',
    );
    const { config } = await loadAxConfig(dir);
    expect(config.entries).toEqual([{ identifier: 'urn:demo:docs', url: '/docs' }]);
  });

  it('picks .ts over .js when both exist (declared lookup order)', async () => {
    writeFileSync(join(dir, 'ax.config.ts'), 'export default { allowlist: ["ts"] };\n');
    writeFileSync(join(dir, 'ax.config.js'), 'module.exports = { allowlist: ["js"] };\n');
    const { config, path } = await loadAxConfig(dir);
    expect(path).toBe(join(dir, 'ax.config.ts'));
    expect(config.allowlist).toEqual(['ts']);
  });

  // The config file was renamed `ard.config.*` → `ax.config.*`. The old name keeps working so an
  // existing project doesn't silently lose its config on upgrade — but never silently: loading a
  // legacy file, or ignoring one that's been superseded, is always warned about.
  it('falls back to a legacy ard.config.* and warns that it is deprecated', async () => {
    writeFileSync(join(dir, 'ard.config.mjs'), "export default { allowlist: ['/legacy'] };\n");
    const { config, path, warnings } = await loadAxConfig(dir);
    expect(path).toBe(join(dir, 'ard.config.mjs'));
    expect(config.allowlist).toEqual(['/legacy']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ard.config.* is deprecated, rename to ax.config.*');
  });

  it('applies the same validation to a legacy ard.config.* as to ax.config.*', async () => {
    writeFileSync(join(dir, 'ard.config.js'), 'module.exports = { denylist: 123 };\n', 'utf8');
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
    await expect(loadAxConfig(dir)).rejects.toThrow(/ard\.config\.js/);
  });

  it('prefers ax.config.* over a legacy ard.config.* and warns that the legacy file is ignored', async () => {
    writeFileSync(join(dir, 'ax.config.mjs'), "export default { allowlist: ['/new'] };\n");
    writeFileSync(join(dir, 'ard.config.mjs'), "export default { allowlist: ['/legacy'] };\n");
    const { config, path, warnings } = await loadAxConfig(dir);
    expect(path).toBe(join(dir, 'ax.config.mjs'));
    expect(config.allowlist).toEqual(['/new']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ignoring ard.config.mjs');
  });

  // The legacy file is ignored outright when superseded — not merged, and not even evaluated, so a
  // stale one that throws can't fail a build that has already migrated to ax.config.*.
  it('never evaluates a superseded ard.config.*, even one that throws', async () => {
    writeFileSync(join(dir, 'ax.config.mjs'), "export default { allowlist: ['/new'] };\n");
    writeFileSync(join(dir, 'ard.config.mjs'), "throw new Error('boom');\n");
    const { config } = await loadAxConfig(dir);
    expect(config.allowlist).toEqual(['/new']);
  });

  // Extension precedence is resolved within a basename, not across the two: any `ax.config.*`
  // outranks every `ard.config.*`, even a higher-precedence extension.
  it('prefers ax.config.cjs over ard.config.ts (name beats extension order)', async () => {
    writeFileSync(join(dir, 'ax.config.cjs'), "module.exports = { allowlist: ['/new'] };\n");
    writeFileSync(join(dir, 'ard.config.ts'), "export default { allowlist: ['/legacy'] };\n");
    const { config, path } = await loadAxConfig(dir);
    expect(path).toBe(join(dir, 'ax.config.cjs'));
    expect(config.allowlist).toEqual(['/new']);
  });

  it('throws AxConfigError with an actionable message on an invalid shape', async () => {
    writeFileSync(
      join(dir, 'ax.config.js'),
      'module.exports = { denylist: "not-an-array" };\n',
      'utf8',
    );
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
    await expect(loadAxConfig(dir)).rejects.toThrow(/denylist/);
  });

  it('throws AxConfigError on an unrecognized top-level key (typo guard)', async () => {
    writeFileSync(
      join(dir, 'ax.config.js'),
      'module.exports = { denyList: [] };\n', // wrong case
      'utf8',
    );
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
  });

  it('throws AxConfigError when the config file itself throws while loading', async () => {
    writeFileSync(join(dir, 'ax.config.js'), "throw new Error('boom');\n", 'utf8');
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
  });

  it('never partially applies an invalid config — defaults are all-or-nothing', async () => {
    writeFileSync(
      join(dir, 'ax.config.js'),
      'module.exports = { allowlist: ["/ok"], denylist: 123 };\n',
      'utf8',
    );
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
  });

  // `ax.config.*` is evaluated as real code (via jiti), not parsed as static JSON — so reading
  // `siteUrl` from a project's own env var, without any special support from the plugin, must
  // keep working. There's no single env var name to support directly (see README): different
  // hosts use different conventions, so this is deliberately left to the developer's own config.
  it('reads siteUrl from an arbitrary env var the developer chooses to read', async () => {
    process.env.MY_CUSTOM_SITE_URL = 'https://from-env.example.com';
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      'export default { siteUrl: process.env.MY_CUSTOM_SITE_URL };\n',
      'utf8',
    );
    const { config } = await loadAxConfig(dir);
    expect(config.siteUrl).toBe('https://from-env.example.com');
  });
});
