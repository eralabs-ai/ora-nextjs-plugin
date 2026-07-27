import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNextConfig } from '../src/next-config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-next-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadNextConfig', () => {
  it('returns defaults with no warnings when no next.config exists', async () => {
    const result = await loadNextConfig(dir);
    expect(result.path).toBeUndefined();
    expect(result.config).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it('extracts basePath/distDir/output from a CommonJS .js object-form config', async () => {
    writeFileSync(
      join(dir, 'next.config.js'),
      "module.exports = { basePath: '/app', distDir: 'build', output: 'standalone' };\n",
      'utf8',
    );
    const result = await loadNextConfig(dir);
    expect(result.config).toEqual({ basePath: '/app', distDir: 'build', output: 'standalone' });
    expect(result.warnings).toEqual([]);
  });

  it('extracts settings from an ESM .mjs default-export config', async () => {
    writeFileSync(
      join(dir, 'next.config.mjs'),
      "const config = { basePath: '/app' };\nexport default config;\n",
      'utf8',
    );
    const result = await loadNextConfig(dir);
    expect(result.config).toEqual({ basePath: '/app' });
  });

  it('extracts settings from a TypeScript .ts config', async () => {
    writeFileSync(
      join(dir, 'next.config.ts'),
      [
        'interface NextConfig { basePath?: string; output?: string }',
        'const config: NextConfig = { basePath: "/app", output: "standalone" };',
        'export default config;',
        '',
      ].join('\n'),
      'utf8',
    );
    const result = await loadNextConfig(dir);
    expect(result.config).toEqual({ basePath: '/app', output: 'standalone' });
  });

  it('calls a function-form config with a phase and defaultConfig, and reads its return value', async () => {
    writeFileSync(
      join(dir, 'next.config.mjs'),
      [
        'export default function (phase, { defaultConfig }) {',
        "  return { ...defaultConfig, basePath: '/from-fn-' + phase };",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const result = await loadNextConfig(dir);
    expect(result.config.basePath).toBe('/from-fn-phase-production-build');
  });

  it('awaits an async function-form config', async () => {
    writeFileSync(
      join(dir, 'next.config.mjs'),
      ['export default async function () {', "  return { basePath: '/async' };", '}', ''].join(
        '\n',
      ),
      'utf8',
    );
    const result = await loadNextConfig(dir);
    expect(result.config.basePath).toBe('/async');
  });

  it('ignores fields that are not the expected type', async () => {
    writeFileSync(join(dir, 'next.config.js'), 'module.exports = { basePath: 42 };\n', 'utf8');
    const result = await loadNextConfig(dir);
    expect(result.config.basePath).toBeUndefined();
  });

  it('warns and falls back to defaults when the config file throws while loading', async () => {
    writeFileSync(join(dir, 'next.config.js'), "throw new Error('boom');\n", 'utf8');
    const result = await loadNextConfig(dir);
    expect(result.config).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/next\.config\.js/);
  });

  it('warns and falls back to defaults when a function-form config throws', async () => {
    writeFileSync(
      join(dir, 'next.config.mjs'),
      "export default function () { throw new Error('bad phase'); }\n",
      'utf8',
    );
    const result = await loadNextConfig(dir);
    expect(result.config).toEqual({});
    expect(result.warnings).toHaveLength(1);
  });

  it('never throws — load failures always resolve to defaults + a warning', async () => {
    writeFileSync(join(dir, 'next.config.ts'), 'this is not valid syntax {{{\n', 'utf8');
    await expect(loadNextConfig(dir)).resolves.toMatchObject({ config: {} });
  });
});
