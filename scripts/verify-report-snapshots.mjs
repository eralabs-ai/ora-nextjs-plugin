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

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(repoRoot, 'fixtures');

const REPORT_PATH = join('.ora', 'report.json');
const GOLDEN_FILE = 'report.golden.json';
const TWINS_GOLDEN_DIR = 'twins.golden';
const CARDS_GOLDEN_DIR = 'cards.golden';

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

/**
 * Every ax-*generated* markdown file under a fixture's public/ (twins + auth.md), by its path
 * relative to public/. User-authored .md files (no generated-by marker) are deliberately absent —
 * they're committed fixture sources, not build output to snapshot.
 */
function generatedMarkdownFiles(fixtureRoot) {
  const publicDir = join(fixtureRoot, 'public');
  const files = new Map();
  const stack = existsSync(publicDir) ? [publicDir] : [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) {
        stack.push(abs);
      } else if (name.endsWith('.md')) {
        const content = readFileSync(abs, 'utf8');
        if (/^generated-by:\s*"@ora-ai\/ax-nextjs"$/m.test(content)) {
          files.set(relative(publicDir, abs), content);
        }
      }
    }
  }
  return files;
}

/** The one per-build-varying twin field is the frontmatter build timestamp. */
function normalizeTwin(content) {
  return content.replace(/^last_updated: .*$/m, 'last_updated: <last_updated>');
}

/** Every .md under a fixture's committed twins.golden/, by path relative to that dir. */
function twinGoldenFiles(fixtureRoot) {
  const goldenDir = join(fixtureRoot, TWINS_GOLDEN_DIR);
  const files = new Map();
  const stack = existsSync(goldenDir) ? [goldenDir] : [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) stack.push(abs);
      else if (name.endsWith('.md')) files.set(relative(goldenDir, abs), readFileSync(abs, 'utf8'));
    }
  }
  return files;
}

/**
 * Twin snapshots: every generated markdown file the fixture build produced is pinned (normalized)
 * under fixtures/<name>/twins.golden/ — the committed corpus the born-passing suite also asserts
 * frontmatter/fence invariants against. Returns failure strings (empty when in sync / updating).
 */
function checkTwinSnapshots(name, fixtureRoot, update) {
  const produced = generatedMarkdownFiles(fixtureRoot);
  const goldenDir = join(fixtureRoot, TWINS_GOLDEN_DIR);

  if (update) {
    rmSync(goldenDir, { recursive: true, force: true });
    for (const [rel, content] of produced) {
      const target = join(goldenDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, normalizeTwin(content), 'utf8');
    }
    if (produced.size > 0) console.log(`updated  ${name}/${TWINS_GOLDEN_DIR} (${produced.size})`);
    return [];
  }

  const failures = [];
  const goldens = twinGoldenFiles(fixtureRoot);
  for (const [rel, content] of produced) {
    const golden = goldens.get(rel);
    if (golden === undefined) {
      failures.push(`${name}: generated public/${rel} has no ${TWINS_GOLDEN_DIR}/${rel} snapshot`);
    } else if (normalizeTwin(content) !== golden) {
      failures.push(`${name}: public/${rel} does not match its ${TWINS_GOLDEN_DIR} snapshot`);
    }
    goldens.delete(rel);
  }
  for (const rel of goldens.keys()) {
    failures.push(
      `${name}: stale snapshot ${TWINS_GOLDEN_DIR}/${rel} — the build no longer produces it`,
    );
  }
  return failures.map((f) => `${f} (run \`pnpm reports:regen\` if intended)`);
}

/**
 * Every MCP server card the fixture build produced, by path relative to public/.well-known/mcp:
 * the root `server-card.json` plus any named `server-card/<server-name>.json`. Cards are fully
 * deterministic (the fixtures pin `siteUrl`, and identity comes from package.json + the mount
 * paths), so unlike reports/twins they're snapshotted verbatim.
 */
function producedServerCards(fixtureRoot) {
  const mcpDir = join(fixtureRoot, 'public', '.well-known', 'mcp');
  const files = new Map();
  const rootCard = join(mcpDir, 'server-card.json');
  if (existsSync(rootCard)) files.set('server-card.json', readFileSync(rootCard, 'utf8'));
  const namedDir = join(mcpDir, 'server-card');
  if (existsSync(namedDir)) {
    for (const name of readdirSync(namedDir)) {
      if (!name.endsWith('.json')) continue;
      files.set(join('server-card', name), readFileSync(join(namedDir, name), 'utf8'));
    }
  }
  return files;
}

/** Every .json under a fixture's committed cards.golden/, by path relative to that dir. */
function cardGoldenFiles(fixtureRoot) {
  const goldenDir = join(fixtureRoot, CARDS_GOLDEN_DIR);
  const files = new Map();
  const stack = existsSync(goldenDir) ? [goldenDir] : [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) stack.push(abs);
      else if (name.endsWith('.json'))
        files.set(relative(goldenDir, abs), readFileSync(abs, 'utf8'));
    }
  }
  return files;
}

/**
 * Card snapshots: every server card the fixture build produced is pinned verbatim under
 * fixtures/<name>/cards.golden/. Returns failure strings (empty when in sync / updating).
 */
function checkCardSnapshots(name, fixtureRoot, update) {
  const produced = producedServerCards(fixtureRoot);
  const goldenDir = join(fixtureRoot, CARDS_GOLDEN_DIR);

  if (update) {
    rmSync(goldenDir, { recursive: true, force: true });
    for (const [rel, content] of produced) {
      const target = join(goldenDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    if (produced.size > 0) console.log(`updated  ${name}/${CARDS_GOLDEN_DIR} (${produced.size})`);
    return [];
  }

  const failures = [];
  const goldens = cardGoldenFiles(fixtureRoot);
  for (const [rel, content] of produced) {
    const golden = goldens.get(rel);
    if (golden === undefined) {
      failures.push(
        `${name}: generated .well-known/mcp/${rel} has no ${CARDS_GOLDEN_DIR}/${rel} snapshot`,
      );
    } else if (content !== golden) {
      failures.push(
        `${name}: .well-known/mcp/${rel} does not match its ${CARDS_GOLDEN_DIR} snapshot`,
      );
    }
    goldens.delete(rel);
  }
  for (const rel of goldens.keys()) {
    failures.push(
      `${name}: stale snapshot ${CARDS_GOLDEN_DIR}/${rel} — the build no longer produces it`,
    );
  }
  return failures.map((f) => `${f} (run \`pnpm reports:regen\` if intended)`);
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
  failures.push(...checkTwinSnapshots(name, fixtureRoot, update));
  failures.push(...checkCardSnapshots(name, fixtureRoot, update));

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
