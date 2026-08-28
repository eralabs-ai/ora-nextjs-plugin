// End-to-end test of the *published artifact*: install the packed tarball into a
// scratch Next.js app (outside the workspace, via plain npm) and run a real build.
// This is the only layer that catches `files`-allowlist gaps, runtime deps that
// accidentally live in devDependencies, and a bin shim that doesn't link/execute.
//
// Usage: node scripts/tarball-e2e.mjs <path-to-tgz>
// Requirements: plain node + npm (no pnpm) — must run on the oldest Node the
// package's `engines` field claims.

import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const tarball = resolve(process.argv[2] ?? '');
if (!tarball || !existsSync(tarball)) {
  console.error('usage: node scripts/tarball-e2e.mjs <path-to-tgz>');
  process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = join(repoRoot, 'fixtures', 'bare');
const app = mkdtempSync(join(tmpdir(), 'ax-tarball-e2e-'));

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: app, stdio: 'inherit', env: { ...process.env, CI: '1' } });

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${label}`);
  if (!ok) failed = true;
};

try {
  cpSync(template, app, {
    recursive: true,
    filter: (src) =>
      !/node_modules|\.next|\.ax|report\.golden\.json|twins\.golden|\.well-known/.test(src),
  });

  // The fixture's tsconfig extends the shared fixtures preset one level up;
  // bring it along and point at the local copy.
  cpSync(join(repoRoot, 'fixtures', 'tsconfig.next.json'), join(app, 'tsconfig.next.json'));
  const tsconfigPath = join(app, 'tsconfig.json');
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  tsconfig.extends = './tsconfig.next.json';
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

  // Detach from the workspace: drop the workspace:* dep; the tarball replaces it.
  const pkgPath = join(app, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = 'ax-tarball-e2e-app';
  delete pkg.devDependencies['@ora-ai/ax-nextjs'];
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  run('npm', ['install', '--no-audit', '--no-fund']);
  run('npm', ['install', '--save-dev', '--no-audit', '--no-fund', tarball]);

  // bin shim: linked, executable, exits 0
  run('npx', ['ax', '--help']);
  check(true, 'ax --help runs from the installed tarball');

  // the real workflow: next build + `postbuild: ax --report --yes`
  run('npm', ['run', 'build']);

  const catalogPath = join(app, 'public', '.well-known', 'ai-catalog.json');
  check(existsSync(catalogPath), 'catalog written to public/.well-known/ai-catalog.json');
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    check(typeof catalog === 'object' && catalog !== null, 'catalog parses as JSON');
  }

  const reportPath = join(app, '.ax', 'report.json');
  check(existsSync(reportPath), 'report written to .ax/report.json');
  if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    check(typeof report.generatedAt === 'string', 'report has a generatedAt timestamp');
  }
} finally {
  rmSync(app, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
