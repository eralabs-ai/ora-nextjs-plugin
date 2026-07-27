import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Installs a faithful fake `@next/env` into `<dir>/node_modules` so `loadProjectEnv` (which resolves
 * `@next/env` from the project and `require`s it) can be exercised without the plugin depending on
 * Next. The fake's `loadEnvConfig` reads `.env` in the given dir and sets each var only if not
 * already present — the "existing value wins" contract the real loader (and our code) rely on.
 *
 * `exportShape` toggles the module's export layout: `'cjs'` mirrors how `@next/env` actually ships
 * (top-level `loadEnvConfig`); `'esm-default'` puts it under `.default`, the transpiled-ESM shape our
 * require path also handles.
 */
export function installFakeNextEnv(dir: string, exportShape: 'cjs' | 'esm-default' = 'cjs'): void {
  const pkgDir = join(dir, 'node_modules', '@next', 'env');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@next/env', version: '0.0.0', main: 'index.js' }),
  );
  const impl = `
function loadEnvConfig(dir, dev, log) {
  const fs = require('node:fs');
  const path = require('node:path');
  let raw;
  try { raw = fs.readFileSync(path.join(dir, '.env'), 'utf8'); } catch { return; }
  for (const line of raw.split('\\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
`;
  const exportLine =
    exportShape === 'cjs'
      ? 'module.exports = { loadEnvConfig };'
      : 'module.exports = { default: { loadEnvConfig } };';
  writeFileSync(join(pkgDir, 'index.js'), impl + exportLine);
}
