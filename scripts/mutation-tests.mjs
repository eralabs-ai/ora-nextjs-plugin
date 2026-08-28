#!/usr/bin/env node
// Multi-build mutation tests over the flagship fixture. The golden layer proves what one build
// produces; ax is a repo-mutating build tool, so the interesting bugs live in build N+1 —
// re-appending to robots.txt, clobbering a user-edited scaffold, leaving orphaned twins behind,
// serving a stale manifest. Each scenario copies the flagship's tracked sources to a tmp dir,
// builds, applies one scripted mutation, rebuilds, and asserts on the delta (targeted assertions,
// never a second golden).
//
// The copy is sources-only (git ls-files), so every scenario starts from the same fresh-checkout
// state `pnpm fixtures:clean` guarantees, and the committed fixture is never touched — tests must
// not mutate the corpus. Dependencies aren't copied or installed: the tmp dir gets ONE absolute
// symlink to the fixture's own node_modules. pnpm lays fixture deps out as relative symlinks into
// the workspace store (a plain `cp -R` dangles; `cp -RL` breaks the .bin shims' relative imports),
// but Node's resolver walks through a symlinked node_modules transparently — and the linked
// @ora-ai/ax is the workspace package, so the harness always exercises the current dist.
//
// Run after `pnpm fixtures:build` (the fixture's node_modules must be linked and ax's dist built).

import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(repoRoot, 'fixtures', 'flagship');

// Goldens and docs are inert in a build; leaving them out keeps copies lean and makes clear the
// harness never compares against them.
const COPY_SKIP = /^(README\.md|report\.golden\.json|twins\.golden\/|cards\.golden\/)/;

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function trackedFixtureFiles() {
  const { stdout } = await execFileAsync('git', ['ls-files', '--', 'fixtures/flagship'], {
    cwd: repoRoot,
  });
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((p) => relative(join('fixtures', 'flagship'), p))
    .filter((rel) => !COPY_SKIP.test(rel));
}

async function makeCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'ax-mutation-'));
  for (const rel of await trackedFixtureFiles()) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(fixtureDir, rel), target);
  }
  // The fixture's tsconfig extends the corpus-shared ../tsconfig.next.json; the copy has no
  // parent, so materialize the base next to it and repoint the extends.
  cpSync(join(fixtureDir, '..', 'tsconfig.next.json'), join(dir, 'tsconfig.next.json'));
  edit(dir, 'tsconfig.json', (content) =>
    content.replace('"../tsconfig.next.json"', '"./tsconfig.next.json"'),
  );
  symlinkSync(join(fixtureDir, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return dir;
}

// The fixture's own build pipeline, step by step: prebuild `ax manifest`, `next build`,
// postbuild `ax --report --yes` — the same technique as dogfood-middleware.mjs (call the bins
// directly, bypass pnpm).
async function build(dir) {
  const bin = (name) => join(dir, 'node_modules', '.bin', name);
  const options = {
    cwd: dir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    maxBuffer: 64 * 1024 * 1024,
  };
  await execFileAsync(bin('ax'), ['manifest'], options);
  await execFileAsync(bin('next'), ['build'], options);
  await execFileAsync(bin('ax'), ['--report', '--yes'], options);
}

// The same normalization verify-report-snapshots.mjs applies: strip the copy's absolute root from
// every path, redact the wall-clock timestamp. What's left must be byte-stable across rebuilds.
function normalizedReport(dir) {
  let raw = readFileSync(join(dir, '.ora', 'report.json'), 'utf8');
  // macOS tmpdirs surface under both /var/... and the /private/var/... realpath.
  for (const root of [dir, join('/private', dir)]) raw = raw.split(`${root}/`).join('');
  const obj = JSON.parse(raw);
  obj.generatedAt = '<generatedAt>';
  return JSON.stringify(obj, null, 2);
}

// Every ax-generated markdown file under public/ (generated-by marker), normalized like the
// snapshot layer normalizes twins (the frontmatter build timestamp is the one varying field).
function normalizedTwins(dir) {
  const publicDir = join(dir, 'public');
  const files = new Map();
  const stack = existsSync(publicDir) ? [publicDir] : [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      const abs = join(current, name);
      if (statSync(abs).isDirectory()) stack.push(abs);
      else if (name.endsWith('.md')) {
        const content = readFileSync(abs, 'utf8');
        if (/^generated-by:\s*"@ora-ai\/ax"$/m.test(content)) {
          files.set(
            relative(publicDir, abs),
            content.replace(/^last_updated: .*$/m, 'last_updated: <last_updated>'),
          );
        }
      }
    }
  }
  return files;
}

function edit(dir, rel, transform) {
  const path = join(dir, rel);
  writeFileSync(path, transform(readFileSync(path, 'utf8')), 'utf8');
}

async function scenario(name, run) {
  console.log(`\n${name}`);
  const dir = await makeCopy();
  try {
    await run(dir);
  } catch (error) {
    failures++;
    console.error(`  ✗ scenario crashed — ${error?.message ?? error}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await scenario(
  'idempotence: a no-change rebuild is byte-stable and append-only writes never double',
  async (dir) => {
    // Strip the committed robots block so build 1 exercises the real append path (in the committed
    // fixture the block is pre-applied precisely so in-tree builds are no-ops).
    edit(dir, join('public', 'robots.txt'), (content) =>
      content.replace(/\n# Added by @ora-ai\/ax[^\n]*\n(?:(?:Agentmap|Sitemap):[^\n]*\n?)*/g, '\n'),
    );

    // Build 1 bootstraps; build 2 is the steady state. The two are NOT byte-identical by design:
    // 404.md is generated before the first build's catalog exists (the documented one-build
    // staleness), so it fills in on build 2. Idempotence is asserted where it must hold: build 3
    // against build 2.
    await build(dir);
    const robotsAfterFirst = readFileSync(join(dir, 'public', 'robots.txt'), 'utf8');
    check(
      'build 1 appends exactly one Agentmap pointer',
      robotsAfterFirst.match(/^Agentmap:/gm)?.length === 1,
    );

    await build(dir);
    const steadyReport = normalizedReport(dir);
    const steadyTwins = normalizedTwins(dir);

    await build(dir);
    const robotsAfterThird = readFileSync(join(dir, 'public', 'robots.txt'), 'utf8');
    check('rebuilds never re-append to robots.txt', robotsAfterThird === robotsAfterFirst);
    check(
      'the normalized report is byte-identical across steady-state rebuilds',
      normalizedReport(dir) === steadyReport,
    );
    const thirdTwins = normalizedTwins(dir);
    check(
      'every generated twin is byte-identical across steady-state rebuilds',
      thirdTwins.size === steadyTwins.size &&
        [...steadyTwins].every(([rel, content]) => thirdTwins.get(rel) === content),
    );
    // Regression guard: the stale-twin sweep once misclassified ax's own 404.md as an orphaned
    // twin on every build after the first (deleted + rewritten in the same run, phantom entry).
    const report = JSON.parse(readFileSync(join(dir, '.ora', 'report.json'), 'utf8'));
    check(
      'a rebuild deletes nothing when nothing changed',
      report.markdownTwins.deleted.length === 0,
      JSON.stringify(report.markdownTwins.deleted),
    );
  },
);

await scenario(
  'auth-method change: the declared status tracks api_key -> oauth2 across builds',
  async (dir) => {
    // The declared descriptor is the published answer for the gated MCP server: it must propagate
    // to the report, the catalog entry, and auth.md on every build — and flipping it must leave
    // no remnant of the previous method behind. Build 1 declares api_key, build 2 flips back to
    // oauth2, covering both directions of the change.
    const readAuthState = () => {
      const report = JSON.parse(readFileSync(join(dir, '.ora', 'report.json'), 'utf8'));
      const catalog = JSON.parse(
        readFileSync(join(dir, 'public', '.well-known', 'ai-catalog.json'), 'utf8'),
      );
      const entry = catalog.entries.find((e) => e.identifier.endsWith(':mcp-server:api-mcp'));
      return {
        surface: report.auth.gatedSurfaces.find((s) => s.path === '/api/mcp'),
        entryStatus: entry?.auth?.status,
        authMd: readFileSync(join(dir, 'public', 'auth.md'), 'utf8'),
        unreviewedMounts: report.mcp.unreviewedMounts,
      };
    };

    edit(dir, 'ax.config.ts', (content) =>
      content.replace("status: 'oauth2',", "status: 'api_key',"),
    );
    await build(dir);
    const first = readAuthState();
    check('build 1 report declares api_key', first.surface?.status === 'api_key');
    check('build 1 catalog entry carries api_key', first.entryStatus === 'api_key');
    check(
      'build 1 auth.md names the API key method only',
      first.authMd.includes('API key') && !first.authMd.includes('OAuth 2.0'),
    );

    edit(dir, 'ax.config.ts', (content) =>
      content.replace("status: 'api_key',", "status: 'oauth2',"),
    );
    await build(dir);
    const second = readAuthState();
    check('build 2 report declares oauth2', second.surface?.status === 'oauth2');
    check('build 2 catalog entry carries oauth2', second.entryStatus === 'oauth2');
    check(
      'build 2 auth.md names the OAuth method with no api_key remnant',
      second.authMd.includes('OAuth 2.0') && !second.authMd.includes('API key'),
    );
    // The flip must never re-open the review gate: a config-declared auth marks its mount
    // reviewed (the committed ax.config.ts IS the recorded decision), so headless builds stay
    // unattended across auth changes — no prompt, no unreviewed action item.
    check(
      'a declared auth change leaves no unreviewed mounts behind',
      first.unreviewedMounts.length === 0 && second.unreviewedMounts.length === 0,
      JSON.stringify([first.unreviewedMounts, second.unreviewedMounts]),
    );
  },
);

await scenario(
  'user-edit preservation: a filled-in scaffold TODO survives the next build',
  async (dir) => {
    // Remove the hand-owned llms.txt and opt into the scaffold, so build 1 generates the starter.
    rmSync(join(dir, 'app', 'llms.txt'), { recursive: true, force: true });
    edit(dir, 'ax.config.ts', (content) =>
      content.replace('scaffoldRobots: true,', 'scaffoldRobots: true,\n  scaffoldLlmsTxt: true,'),
    );

    await build(dir);
    const scaffoldPath = join(dir, 'app', 'llms.txt', 'route.ts');
    check('build 1 scaffolds app/llms.txt/route.ts', existsSync(scaffoldPath));
    check(
      'the scaffold ships its TODO placeholders',
      readFileSync(scaffoldPath, 'utf8').includes('TODO'),
    );

    const humanLine = '- Compare demo fares for a route before recommending an itinerary.';
    edit(dir, join('app', 'llms.txt', 'route.ts'), (content) =>
      content.replace('- TODO: a task an agent should use this site for', humanLine),
    );

    await build(dir);
    const afterRebuild = readFileSync(scaffoldPath, 'utf8');
    check('the human-edited line survives build 2 verbatim', afterRebuild.includes(humanLine));
    check(
      'the replaced TODO line does not come back',
      !afterRebuild.includes('- TODO: a task an agent should use this site for'),
    );
  },
);

await scenario(
  'staleness: deleting a page removes its orphaned twin and manifest entry',
  async (dir) => {
    await build(dir);
    check('build 1 generates the /results twin', existsSync(join(dir, 'public', 'results.md')));

    rmSync(join(dir, 'app', 'results'), { recursive: true, force: true });

    await build(dir);
    check(
      'the orphaned twin is deleted on build 2',
      !existsSync(join(dir, 'public', 'results.md')),
    );
    const manifest = readFileSync(join(dir, 'ax-manifest.ts'), 'utf8');
    check(
      'the manifest no longer lists /results',
      !manifest.includes("'/results'") && !manifest.includes('"/results"'),
    );
  },
);

await scenario(
  'additive: a new page and a new MCP tool land in twins, cards, and the report',
  async (dir) => {
    await build(dir);
    const cardPath = join(dir, 'public', '.well-known', 'mcp', 'server-card.json');
    check(
      'build 1 card carries only search_flights',
      JSON.parse(readFileSync(cardPath, 'utf8'))
        .tools.map((t) => t.name)
        .join(',') === 'search_flights',
    );

    mkdirSync(join(dir, 'app', 'press'), { recursive: true });
    writeFileSync(
      join(dir, 'app', 'press', 'page.tsx'),
      `export const metadata = {
  title: 'Press — Ora Air',
  description: 'Press resources and media contacts for the Ora Air demo.',
};

export default function PressPage() {
  return (
    <main>
      <h1>Press</h1>
      <p>
        Ora Air is a demonstration airline used to exercise agent booking flows end-to-end. For
        media inquiries about the demo, its route network, or the booking tools it exposes to
        agents, use the contact address in the agent guide.
      </p>
      <p>
        Facts and figures: twelve airports across eight countries, one-way fares only, and a test
        payment card that always settles. No real inventory is represented anywhere in the app.
      </p>
    </main>
  );
}
`,
      'utf8',
    );
    edit(dir, join('app', 'api', 'public', '[transport]', 'route.ts'), (content) =>
      content.replace(
        '  (server) => {',
        `  (server) => {
    server.tool(
      "get_baggage_policy",
      "Get the checked and carry-on baggage policy for a fare class.",
      { fareClass: z.string().describe("Fare class code, e.g. 'Y', 'W', 'J'") },
      async ({ fareClass }) => ({
        content: [{ type: "text", text: \`Fare \${fareClass}: 1 carry-on, 1 checked bag.\` }],
      })
    );
`,
      ),
    );

    await build(dir);
    check('the new page gains a twin on build 2', existsSync(join(dir, 'public', 'press.md')));
    const tools = JSON.parse(readFileSync(cardPath, 'utf8')).tools.map((t) => t.name);
    check(
      'the new tool lands in the public server card',
      tools.includes('get_baggage_policy'),
      tools.join(','),
    );
    const report = JSON.parse(readFileSync(join(dir, '.ora', 'report.json'), 'utf8'));
    const publicMount = report.mcp.mounts.find((m) => m.pathname === '/api/public/mcp');
    check(
      'the new tool lands in report.mcp.mounts',
      publicMount?.tools.includes('get_baggage_policy'),
    );
    const manifest = readFileSync(join(dir, 'ax-manifest.ts'), 'utf8');
    check('the postbuild-refreshed manifest lists the new twin', manifest.includes('/press.md'));
  },
);

await scenario(
  'manifest drift: removing the gated page refreshes gatedPaths via the prebuild',
  async (dir) => {
    await build(dir);
    check(
      'build 1 manifest gates /account',
      readFileSync(join(dir, 'ax-manifest.ts'), 'utf8').includes('/account'),
    );

    rmSync(join(dir, 'app', 'account'), { recursive: true, force: true });

    await build(dir);
    const manifest = readFileSync(join(dir, 'ax-manifest.ts'), 'utf8');
    check('build 2 manifest no longer knows /account at all', !manifest.includes('/account'));
  },
);

if (failures > 0) {
  console.error(`\n${failures} mutation probe(s) failed.`);
  process.exit(1);
}
console.log('\nAll mutation probes passed.');
