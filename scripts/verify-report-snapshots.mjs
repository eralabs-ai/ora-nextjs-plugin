#!/usr/bin/env node
// Report-snapshot end-to-end layer. Every fixture whose `postbuild` runs `ax --report` emits a
// machine-readable build report to `.ora/report.json` during a REAL `next build` (that build is
// itself the proof the fixture is a legitimate, buildable Next.js app). This script captures each
// of those reports and diffs it against a committed golden — `fixtures/<name>/report.golden.json` —
// so the plugin's detections and recommendations are pinned to exactly what we expect.
//
// The reports live in gitignored `.ora/` (build output); only the normalized goldens are tracked.
//
// Usage (run AFTER `pnpm fixtures:build`, which produces the reports):
//   node scripts/verify-report-snapshots.mjs            # verify against goldens (CI)
//   node scripts/verify-report-snapshots.mjs --update   # (re)write the goldens
//
// A developer regenerates every golden in one command with `pnpm reports:regen`
// (= `pnpm fixtures:build && node scripts/verify-report-snapshots.mjs --update`).

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(repoRoot, 'fixtures');

const REPORT_PATH = join('.ora', 'report.json');
const GOLDEN_FILE = 'report.golden.json';

/**
 * The reports carry three fields that vary per run or per checkout and must be neutralized before
 * comparison: `generatedAt` (wall-clock `new Date()`), and the absolute on-disk write paths
 * `catalog.path` / `mcp.serverCardPath` / any `scaffolds.*.path` (they embed the checkout's absolute
 * fixture root, e.g. `/Users/you/...`). We redact the timestamp and rewrite every absolute path that
 * starts with the fixture root into a root-relative one. Nothing else in the report is
 * non-deterministic — the fixtures pin `siteUrl` and their route topology is fixed — so a normalized
 * report is byte-stable across machines and across repeated builds.
 */
function normalize(report, fixtureRoot) {
  // Rewrite absolute paths -> relative by stripping the fixture-root prefix from every string,
  // done over the serialized form so it reaches every nested field (catalog, mcp, scaffolds).
  const relativized = JSON.stringify(report).split(`${fixtureRoot}/`).join('');
  const obj = JSON.parse(relativized);
  obj.generatedAt = '<generatedAt>';
  return obj;
}

function serialize(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/** Fixtures that run `ax --report` in `postbuild` — the authoritative set that must emit a report. */
function fixturesWithReports() {
  const names = [];
  for (const name of readdirSync(fixturesDir)) {
    const pkgPath = join(fixturesDir, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const postbuild = pkg.scripts?.postbuild ?? '';
    // Match the `ax` bin as a whole word so a hypothetical `axios`-style script never counts.
    if (/(^|\s|&&|;)ax(\s|$)/.test(postbuild)) names.push(name);
  }
  return names.sort();
}

const update = process.argv.includes('--update');
const failures = [];
let checked = 0;

for (const name of fixturesWithReports()) {
  const fixtureRoot = join(fixturesDir, name);
  const reportPath = join(fixtureRoot, REPORT_PATH);
  const goldenPath = join(fixtureRoot, GOLDEN_FILE);

  if (!existsSync(reportPath)) {
    failures.push(
      `${name}: no ${REPORT_PATH} — did the fixture build and run \`ax --report\`? ` +
        `Run \`pnpm fixtures:build\` first.`,
    );
    continue;
  }

  const actual = serialize(normalize(JSON.parse(readFileSync(reportPath, 'utf8')), fixtureRoot));

  if (update) {
    writeFileSync(goldenPath, actual, 'utf8');
    console.log(`updated  ${name}/${GOLDEN_FILE}`);
    checked++;
    continue;
  }

  if (!existsSync(goldenPath)) {
    failures.push(`${name}: no golden ${GOLDEN_FILE} — create it with \`pnpm reports:regen\`.`);
    continue;
  }

  const expected = readFileSync(goldenPath, 'utf8');
  if (actual === expected) {
    console.log(`ok       ${name}`);
  } else {
    failures.push(
      `${name}: report does not match ${GOLDEN_FILE} (run \`pnpm reports:regen\` if intended)`,
    );
  }
  checked++;
}

if (checked === 0) {
  console.error('No fixture reports found. Run `pnpm fixtures:build` first.');
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} report snapshot failure(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`\n${update ? 'Wrote' : 'Verified'} ${checked} report snapshot(s).`);
