#!/usr/bin/env node
// Removes everything ax generates into the fixtures, so a `reports:regen` always regenerates the
// goldens from the same state CI builds from: a fresh checkout. Without this, a generated artifact
// lingering from an earlier local build changes the next build's *behavior* — the committed MCP
// server card is the persistence layer for the gating decision, so a leftover card makes a mount
// look "reviewed" locally while CI (no card) reports it unreviewed. That exact drift shipped bad
// goldens once (PR #20's fixture goldens); this script makes the regen hermetic instead of relying
// on everyone's working tree being clean.
//
// Deliberately surgical, never `git clean`: only the exact well-known JSON artifacts, the `.ora/`
// report dir, and markdown files carrying ax's generated-by marker are removed. Hand-authored
// fixture sources (e.g. markdown-twins/public/hand.md, discovery/public/agents.md) have no marker
// and are never touched.

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(repoRoot, 'fixtures');

const GENERATED_JSON = [
  join('public', '.well-known', 'ai-catalog.json'),
  join('public', '.well-known', 'mcp', 'server-card.json'),
  // The named per-server cards a multi-server fixture emits — the whole directory is generated.
  join('public', '.well-known', 'mcp', 'server-card'),
  // The serving-manifest data module `ax manifest` (a fixture's prebuild) regenerates — build
  // output in a fixture, so the regen must start without one, exactly like a fresh checkout.
  'ax-manifest.ts',
  'ax-manifest.js',
  join('src', 'ax-manifest.ts'),
  join('src', 'ax-manifest.js'),
];

/** Matches the frontmatter marker every ax-generated markdown file carries. */
const GENERATED_BY_RE = /^generated-by:\s*"@ora-ai\/ax"$/m;

let removed = 0;

function remove(path) {
  rmSync(path, { recursive: true, force: true });
  removed++;
}

for (const name of readdirSync(fixturesDir)) {
  const fixtureRoot = join(fixturesDir, name);
  if (!existsSync(join(fixtureRoot, 'package.json'))) continue;

  for (const rel of GENERATED_JSON) {
    const path = join(fixtureRoot, rel);
    if (existsSync(path)) remove(path);
  }

  const oraDir = join(fixtureRoot, '.ora');
  if (existsSync(oraDir)) remove(oraDir);

  // Generated markdown (twins + auth.md): identified by the marker, never by name, so
  // hand-authored .md fixture sources survive.
  const publicDir = join(fixtureRoot, 'public');
  const stack = existsSync(publicDir) ? [publicDir] : [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        stack.push(abs);
      } else if (entry.endsWith('.md') && GENERATED_BY_RE.test(readFileSync(abs, 'utf8'))) {
        remove(abs);
      }
    }
  }
}

console.log(`Removed ${removed} generated fixture artifact(s).`);
