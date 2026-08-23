import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import {
  CATALOG_OUTPUT_PATH,
  REPORT_OUTPUT_PATH,
  SERVER_CARD_DIR_OUTPUT_PATH,
  SERVER_CARD_OUTPUT_PATH,
} from '../src/write.js';

/** Writes a minimal app with a single mcp-handler mount and a configured siteUrl. */
function writeMcpFixture(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0' }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'ax.config.mjs'),
    "export default { siteUrl: 'https://example.com' };\n",
    'utf8',
  );
  const routeDir = join(dir, 'app', '[transport]');
  mkdirSync(routeDir, { recursive: true });
  writeFileSync(
    join(routeDir, 'route.ts'),
    `import { createMcpHandler } from 'mcp-handler';\n` +
      `const handler = createMcpHandler((server) => { server.tool('roll_dice', 'd', {}, async () => ({})); });\n` +
      `export { handler as GET };\n`,
    'utf8',
  );
}

/** An app carrying every artifact the plugin detects — the "nothing left to do" end state. */
function writeFullyAgentReadyApp(dir: string): void {
  writeMcpFixture(dir);

  const publicDir = join(dir, 'public');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, 'llms.txt'), '# demo\n', 'utf8');
  // A hand-authored homepage twin (no generated-by marker): the markdown-fallback checks read as
  // addressed without this synthetic app needing a real prerendered build output.
  writeFileSync(join(publicDir, 'index.md'), '# demo home\n', 'utf8');
  writeFileSync(join(publicDir, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');
  writeFileSync(join(publicDir, 'sitemap.xml'), '<urlset></urlset>\n', 'utf8');
  writeFileSync(join(publicDir, 'agents.md'), '# When to use\n', 'utf8');
  writeFileSync(
    join(publicDir, 'openapi.json'),
    JSON.stringify({ openapi: '3.1.0', info: { title: 'Demo API' } }),
    'utf8',
  );

  writeFileSync(
    join(dir, 'app', 'layout.tsx'),
    'export default function Layout() {\n' +
      '  return <script type="application/ld+json">{}</script>;\n' +
      '}\n',
    'utf8',
  );
  writeFileSync(
    join(dir, 'app', 'page.tsx'),
    'export default function Page() {\n' +
      '  return <form toolname="subscribe" tooldescription="Subscribe" />;\n' +
      '}\n',
    'utf8',
  );

  // A wired negotiation middleware (detection is textual — the import specifier is the signal),
  // so the markdown-negotiation checks read as addressed.
  writeFileSync(
    join(dir, 'middleware.ts'),
    "import { withAx } from '@ora-ai/ax/middleware';\n" +
      "import { axManifest } from './ax-manifest';\n" +
      'export default withAx({ manifest: axManifest });\n',
    'utf8',
  );
}

let dir: string;
let stdout: string[];
let stderr: string[];
// The shared IO auto-confirms the publish gate: `confirm` present marks the run as interactive
// (no TTY needed) and returns yes, so the many "it writes …" tests keep exercising a real write.
// The gate's refuse/decline paths get their own dedicated tests below that override `confirm`.
const io = {
  stdout: (line: string) => stdout.push(line),
  stderr: (line: string) => stderr.push(line),
  confirm: async () => true,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-cli-'));
  stdout = [];
  stderr = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runCli', () => {
  it('writes a valid catalog and exits 0', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
    expect(stdout.some((l) => l.includes('wrote'))).toBe(true);
    expect(stderr).toEqual([]);
  });

  it('accepts --cwd as an explicit override', async () => {
    const code = await runCli(['--cwd', dir], io);
    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
  });

  it('accepts --cwd=<dir> equals form', async () => {
    const code = await runCli([`--cwd=${dir}`], io);
    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
  });

  it('accepts a relative --cwd and still loads ax.config from it', async () => {
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );

    // A relative path here regresses to a bug where `existsSync` (resolved against
    // `process.cwd()`) found the config file, but jiti (resolved against this package's own
    // location) then failed to load it — see cli.ts's `resolve()` call.
    const relativeDir = relative(process.cwd(), dir);
    const code = await runCli(['--cwd', relativeDir], io);

    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    expect(parsed.host.identifier).toBe('did:web:example.com');
  });

  it('exits 1 with a clear message when --cwd= has an empty value', async () => {
    const code = await runCli(['--cwd='], { ...io, cwd: dir });
    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('--cwd requires a directory argument'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('prints help and exits 0 for --help, without writing anything', async () => {
    const code = await runCli(['--help'], { ...io, cwd: dir });
    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('Usage:'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('exits 1 with a clear message on an unrecognized argument', async () => {
    const code = await runCli(['--bogus'], { ...io, cwd: dir });
    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('Unrecognized argument'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('exits 1 and reports errors without writing when --cwd is missing its value', async () => {
    const code = await runCli(['--cwd'], { ...io, cwd: dir });
    expect(code).toBe(1);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('defaults to process.cwd() when no cwd is given anywhere', async () => {
    // Just verifies it doesn't throw when relying on the real process cwd; output location isn't
    // asserted since it would write into the real repo.
    const originalCwd = process.cwd;
    process.cwd = () => dir;
    try {
      const code = await runCli([], io);
      expect(code).toBe(0);
    } finally {
      process.cwd = originalCwd;
    }
  });

  it('writes a catalog that round-trips as valid JSON', async () => {
    await runCli([], { ...io, cwd: dir });
    const parsed = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    expect(parsed.specVersion).toBe('1.0');
    expect(parsed.entries).toEqual([]);
  });

  it('exits 1 with an actionable message and writes nothing on an invalid ax.config', async () => {
    writeFileSync(join(dir, 'ax.config.mjs'), 'export default { emit: 123 };\n', 'utf8');

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('ax.config'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('exits 1 with an actionable message when ax.config isGated is not a function', async () => {
    writeFileSync(join(dir, 'ax.config.mjs'), 'export default { isGated: 123 };\n', 'utf8');

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('isGated'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  // The `ard.config.*` → `ax.config.*` rename is a warn-and-keep-working deprecation, so a build
  // that hasn't migrated yet must still succeed — and must say so in its output.
  it('still builds from a legacy ard.config, printing the deprecation warning', async () => {
    writeFileSync(
      join(dir, 'ard.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('ard.config.* is deprecated'))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    expect(parsed.host.identifier).toBe('did:web:example.com');
  });

  it('warns (but still succeeds) when next.config sets basePath', async () => {
    writeFileSync(join(dir, 'next.config.mjs'), "export default { basePath: '/app' };\n", 'utf8');

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('basePath'))).toBe(true);
  });

  it('pluralizes the entry count', async () => {
    writeMcpFixture(dir);

    await runCli([], { ...io, cwd: dir });
    expect(stdout.some((l) => l.includes('1 entry referenced'))).toBe(true);
    expect(stdout.some((l) => l.includes('1 entries referenced'))).toBe(false);

    stdout = [];
    writeFileSync(
      join(dir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.1.0' }),
      'utf8',
    );
    await runCli([], { ...io, cwd: dir });
    expect(stdout.some((l) => l.includes('2 entries referenced'))).toBe(true);
  });

  it('also writes the well-known MCP server card when a mount is detected', async () => {
    writeMcpFixture(dir);

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(existsSync(join(dir, SERVER_CARD_OUTPUT_PATH))).toBe(true);
    const card = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(card).toMatchObject({
      serverUrl: 'https://example.com/mcp',
      tools: [{ name: 'roll_dice' }],
    });
    expect(stdout.some((l) => l.includes('MCP server card'))).toBe(true);
  });

  it('writes a gated MCP mount with auth markers on both the entry and the server card', async () => {
    // A gated server is published *as gated*, never dropped and never advertised as open: the
    // entry carries auth.status "unknown" and the card authentication.required — and that written
    // card is what records the decision for future builds.
    writeMcpFixture(dir);
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com', isGated: (t) => ['/mcp'].includes(t.path) };\n",
      'utf8',
    );

    const code = await runCli(['--yes'], { ...io, cwd: dir });

    expect(code).toBe(0);
    const catalog = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0].auth).toEqual({ status: 'unknown' });
    const card = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(card.authentication).toEqual({ required: true });
  });

  it('writes no server card when there is no MCP mount', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(existsSync(join(dir, SERVER_CARD_OUTPUT_PATH))).toBe(false);
  });

  it('writes no build report by default (opt-in only)', async () => {
    writeMcpFixture(dir);

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(existsSync(join(dir, REPORT_OUTPUT_PATH))).toBe(false);
  });

  it('--report writes the machine-readable build report to .ora/report.json', async () => {
    writeMcpFixture(dir);

    const code = await runCli(['--report'], { ...io, cwd: dir });

    expect(code).toBe(0);
    const reportPath = join(dir, REPORT_OUTPUT_PATH);
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report).toMatchObject({
      siteUrl: 'https://example.com',
      catalog: {
        path: join(dir, CATALOG_OUTPUT_PATH),
        target: 'static',
        entryCount: 1,
      },
      mcp: {
        mounts: [{ pathname: '/mcp', tools: ['roll_dice'] }],
        serverCardPath: join(dir, SERVER_CARD_OUTPUT_PATH),
      },
    });
    // Every detect-and-recommend artifact reports presence; this fixture has none of them.
    expect(report.artifacts.robotsTxt).toEqual({ found: false });
    expect(report.artifacts.llmsTxt).toEqual({ found: false });
    // The report mirrors the printed channels verbatim.
    expect(Array.isArray(report.warnings)).toBe(true);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(stdout.some((l) => l.includes('machine-readable build report'))).toBe(true);
  });

  it('prints token-aware artifact sizes and records them in the report', async () => {
    writeMcpFixture(dir);

    const code = await runCli(['--report'], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(
      stdout.some((l) => l.includes('✓ wrote (sizes show estimated tokens, chars ÷ 4):')),
    ).toBe(true);
    expect(stdout.some((l) => /ai-catalog\.json — \d+ B \(~\d+ tokens\)/.test(l))).toBe(true);

    const report = JSON.parse(readFileSync(join(dir, REPORT_OUTPUT_PATH), 'utf8'));
    const catalogSize = report.sizes.find(
      (s: { artifact: string }) => s.artifact === 'ai-catalog.json',
    );
    expect(catalogSize).toMatchObject({
      artifact: 'ai-catalog.json',
      path: CATALOG_OUTPUT_PATH,
    });
    expect(catalogSize.chars).toBeGreaterThan(0);
    expect(catalogSize.tokens).toBe(Math.round(catalogSize.chars / 4));
    // The MCP fixture also emits a server card, so it is measured too.
    expect(report.sizes.some((s: { artifact: string }) => s.artifact === 'mcp-server-card')).toBe(
      true,
    );
  });

  it('sizes a scaffolded llms.txt by its served body, not the route.ts wrapper', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com', scaffoldLlmsTxt: true };\n",
      'utf8',
    );
    mkdirSync(join(dir, 'app'), { recursive: true });

    const code = await runCli(['--report'], { ...io, cwd: dir });
    expect(code).toBe(0);

    const routeFile = join(dir, 'app', 'llms.txt', 'route.ts');
    const routeFileChars = readFileSync(routeFile, 'utf8').length;
    const report = JSON.parse(readFileSync(join(dir, REPORT_OUTPUT_PATH), 'utf8'));
    const llmsSize = report.sizes.find((s: { artifact: string }) => s.artifact === 'llms.txt');

    expect(llmsSize).toBeDefined();
    expect(llmsSize.path).toBe(join('app', 'llms.txt', 'route.ts'));
    // The served markdown body is smaller than the route.ts file (JS wrapper + JSON-escaped literal).
    expect(llmsSize.chars).toBeLessThan(routeFileChars);
    // And it's a valid measurement of real content, not zero.
    expect(llmsSize.chars).toBeGreaterThan(0);
  });

  it('does not warn about truncation for a normal, small build', async () => {
    // The oversize branch is exercised deterministically in the artifact-size unit test; here we
    // just guard against the warning firing spuriously on a typical (well under 100K) build.
    writeMcpFixture(dir);

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('truncates responses over 100K chars'))).toBe(false);
  });

  it('--report=<path> writes to a custom path', async () => {
    writeMcpFixture(dir);

    const code = await runCli(['--report=agent-report.json'], { ...io, cwd: dir });
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'agent-report.json'))).toBe(true);
  });

  it('ax.config `report: true` enables the report without a CLI flag', async () => {
    // A separate tmp dir (not a rewrite of this test file's shared config): Node's native ESM
    // cache means the same ax.config.mjs path is only evaluated once per process, and unlike a
    // real CLI run the test suite is one long-lived process.
    const configDir = mkdtempSync(join(tmpdir(), 'ax-cli-report-'));
    try {
      writeFileSync(join(configDir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
      writeFileSync(
        join(configDir, 'ax.config.mjs'),
        "export default { siteUrl: 'https://example.com', report: true };\n",
        'utf8',
      );

      const code = await runCli([], { ...io, cwd: configDir });
      expect(code).toBe(0);
      expect(existsSync(join(configDir, REPORT_OUTPUT_PATH))).toBe(true);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// Review-before-publish (Phase 2.3): the first publish of a catalog is gated behind confirmation,
// and the run always prints the surface it is about to expose first. This is the backstop the
// auth/gating work leans on — the last chance to catch a surface that shouldn't be public.
describe('runCli review-before-publish gate', () => {
  const noConfirmIo = {
    stdout: (line: string) => stdout.push(line),
    stderr: (line: string) => stderr.push(line),
    // No `confirm` and no TTY in the test process → a non-interactive run.
  };

  it('refuses to write a first-time catalog in a non-interactive run without --yes', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const code = await runCli([], { ...noConfirmIo, cwd: dir });

    expect(code).toBe(1);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
    expect(stderr.some((l) => l.includes('Re-run with --yes'))).toBe(true);
  });

  it('writes a first-time catalog non-interactively when --yes is passed', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const code = await runCli(['--yes'], { ...noConfirmIo, cwd: dir });

    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
  });

  it('does not gate a re-run once a catalog already exists at the target path', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    // First publish with --yes, then a plain re-run (no --yes, non-interactive) must still succeed.
    expect(await runCli(['--yes'], { ...noConfirmIo, cwd: dir })).toBe(0);

    stdout = [];
    stderr = [];
    const code = await runCli([], { ...noConfirmIo, cwd: dir });

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
  });

  it('aborts without writing when the interactive confirm is declined', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const code = await runCli([], {
      ...noConfirmIo,
      cwd: dir,
      confirm: async () => false,
    });

    expect(code).toBe(1);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
    expect(stdout.some((l) => l.includes('Aborted'))).toBe(true);
  });

  it('asks about an unreviewed MCP mount at the gate and records "requires login" in the card', async () => {
    // No card on disk and no isGated → the mount has never been reviewed. The interactive gate
    // shows the route tree, asks per server, and the answer lands in the card it writes — so the
    // question is asked once, not per build.
    writeMcpFixture(dir);

    const questions: string[] = [];
    const code = await runCli([], {
      ...noConfirmIo,
      cwd: dir,
      confirm: async (question: string) => {
        questions.push(question);
        // "Is the MCP server at /mcp public…?" → no (requires login); "Publish this catalog?" → yes.
        return !question.includes('public');
      },
    });

    expect(code).toBe(0);
    expect(questions.some((q) => q.includes('/mcp') && q.includes('public'))).toBe(true);
    expect(stdout.some((l) => l.includes('no gating decision on record'))).toBe(true);
    expect(stdout.some((l) => l.includes('⚙ roll_dice'))).toBe(true);
    const card = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(card.authentication).toEqual({ required: true });
    const catalog = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    expect(catalog.entries[0].auth).toEqual({ status: 'unknown' });

    // Second run: the committed card is the record — the gating question is not asked again.
    questions.length = 0;
    expect(
      await runCli([], {
        ...noConfirmIo,
        cwd: dir,
        confirm: async (question: string) => {
          questions.push(question);
          return true;
        },
      }),
    ).toBe(0);
    expect(questions.some((q) => q.includes('public'))).toBe(false);
    // And the gated decision survives the rebuild.
    const rebuilt = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(rebuilt.authentication).toEqual({ required: true });
  });

  it('warns (instead of asking) about an unreviewed mount under --yes, and notes it in the report', async () => {
    writeMcpFixture(dir);

    const code = await runCli(['--yes', '--report'], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(
      stdout.some((l) => l.includes('no gating decision on record') && l.includes('/mcp')),
    ).toBe(true);
    const report = JSON.parse(readFileSync(join(dir, '.ora', 'report.json'), 'utf8'));
    expect(report.mcp.unreviewedMounts).toEqual(['/mcp']);
  });

  it('--dry-run prints the exposure summary and writes nothing', async () => {
    writeMcpFixture(dir);

    const code = await runCli(['--dry-run'], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
    expect(existsSync(join(dir, SERVER_CARD_OUTPUT_PATH))).toBe(false);
    expect(stdout.some((l) => l.includes('About to expose'))).toBe(true);
    expect(stdout.some((l) => l.includes('nothing written'))).toBe(true);
  });

  it('prints the surface (entries + server card) it is about to expose before writing', async () => {
    writeMcpFixture(dir);

    await runCli(['--yes'], { ...io, cwd: dir });

    const output = stdout.join('\n');
    expect(output).toContain('About to expose 1 catalog entry:');
    // One short line: the friendly name and the server it points at — no URN or media type.
    expect(output).toContain('• MCP server card → https://example.com/mcp');
    expect(output).not.toContain('urn:air:example.com:mcp-server (');
  });
});

// The footer is where the build stops talking to a person and starts talking to the coding agent
// that will do the remaining work: where the machine-readable report is, where the skill server is,
// and how to verify the result against the deployed site.
describe('runCli agent handoff footer', () => {
  it('points at the written report with a copy-paste agent prompt — no vendor pitch', async () => {
    writeMcpFixture(dir);

    await runCli(['--report'], { ...io, cwd: dir });

    const output = stdout.join('\n');
    expect(output).toContain(`Find your report at: ${join(dir, REPORT_OUTPUT_PATH)}`);
    expect(output).toContain('📋 Copy this prompt to your coding agent:');
    expect(output).toContain(`Read ${join(dir, REPORT_OUTPUT_PATH)} and work through every check`);
    // The prompt names the twin skip list, so an agent addresses twin-less routes too — not just
    // the ora checks (the report-driven fix an early demo run missed).
    expect(output).toContain('markdownTwins.skipped');
    expect(output).not.toContain('ora.ai');
  });

  it('suppresses the terminal recommendation list when the report carries it', async () => {
    writeMcpFixture(dir);

    await runCli(['--report'], { ...io, cwd: dir });
    const withReport = stdout.join('\n');
    expect(withReport).not.toContain('Recommendations to improve agent-readiness:');

    // Without a report, the recommendations still print — they'd otherwise be lost entirely.
    stdout.length = 0;
    rmSync(join(dir, CATALOG_OUTPUT_PATH), { force: true });
    await runCli([], { ...io, cwd: dir });
    expect(stdout.join('\n')).toContain('Recommendations to improve agent-readiness:');
  });

  it('says how to get the report when this run did not write one', async () => {
    writeMcpFixture(dir);

    await runCli([], { ...io, cwd: dir });

    expect(stdout.join('\n')).toContain('re-run with --report');
  });

  it('prints nothing for a site that already has every artifact ax knows about', async () => {
    writeFullyAgentReadyApp(dir);

    const code = await runCli(['--report'], { ...io, cwd: dir });

    expect(code).toBe(0);
    const report = JSON.parse(readFileSync(join(dir, REPORT_OUTPUT_PATH), 'utf8'));
    expect(report.ora.checks.filter((c: { status: string }) => c.status === 'actionable')).toEqual(
      [],
    );
    // Nothing left to hand off — a build with no remaining work doesn't get a to-do list.
    expect(stdout.join('\n')).not.toContain('Find your report at');
  });
});

// The bare-`ax` tip nudges a first-time, un-configured, interactive run toward the wizard. It must
// fire only in exactly that situation — never under --yes, never once a config already exists (in
// either the current or legacy name), and never on a re-run.
describe('runCli ax init tip', () => {
  const TIP = 'run `ax init`';

  it('suggests ax init on a first interactive run with no config', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    await runCli([], { ...io, cwd: dir });
    expect(stdout.some((l) => l.includes(TIP))).toBe(true);
  });

  it('does not suggest it under --yes (that run already consented to run headless)', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    await runCli(['--yes'], { ...io, cwd: dir });
    expect(stdout.some((l) => l.includes(TIP))).toBe(false);
  });

  it('does not suggest it when an ax.config already exists', async () => {
    writeMcpFixture(dir); // writes ax.config.mjs
    await runCli([], { ...io, cwd: dir });
    expect(stdout.some((l) => l.includes(TIP))).toBe(false);
  });

  it('does not suggest it when only a legacy ard.config exists', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    writeFileSync(
      join(dir, 'ard.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );
    await runCli([], { ...io, cwd: dir });
    expect(stdout.some((l) => l.includes(TIP))).toBe(false);
  });

  it('does not suggest it on a re-run once a catalog already exists', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
    await runCli([], { ...io, cwd: dir }); // first publish
    stdout = [];
    await runCli([], { ...io, cwd: dir }); // re-run
    expect(stdout.some((l) => l.includes(TIP))).toBe(false);
  });
});

// Multi-server hosts: one card per mount (each server's persistence slot), the primary's card at
// the root well-known path, and the primary decision itself asked-once like the gating one.
describe('runCli multi-mount server cards', () => {
  /** Two mounts, modeled on the demo app: an open /api/public/mcp and a withMcpAuth /api/mcp. */
  function writeTwoMountFixture(dir: string): void {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' }),
      'utf8',
    );
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );
    const publicDir = join(dir, 'app', 'api', 'public', 'mcp');
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(
      join(publicDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => { server.tool('search', 'd', {}, async () => ({})); });\n` +
        `export { handler as GET };\n`,
      'utf8',
    );
    const gatedDir = join(dir, 'app', 'api', 'mcp');
    mkdirSync(gatedDir, { recursive: true });
    writeFileSync(
      join(gatedDir, 'route.ts'),
      `import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => { server.tool('pay', 'd', {}, async () => ({})); });\n` +
        `const auth = withMcpAuth(handler, async () => undefined);\n` +
        `export { auth as GET };\n`,
      'utf8',
    );
  }

  it('writes the primary card at the root path and every card at its named slot (--yes)', async () => {
    writeTwoMountFixture(dir);

    const code = await runCli(['--yes', '--report'], { ...io, cwd: dir });

    expect(code).toBe(0);
    // Default primary = the public server; its card owns the root path.
    const root = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(root.serverUrl).toBe('https://example.com/api/public/mcp');
    const namedDir = join(dir, SERVER_CARD_DIR_OUTPUT_PATH);
    const publicCard = JSON.parse(readFileSync(join(namedDir, 'api-public-mcp.json'), 'utf8'));
    const gatedCard = JSON.parse(readFileSync(join(namedDir, 'api-mcp.json'), 'utf8'));
    expect(publicCard.authentication).toBeUndefined();
    expect(gatedCard.authentication).toEqual({ required: true });

    // Exactly one public server → it is the primary with nothing to confirm: no warning, and the
    // report records the choice without flagging it unreviewed.
    expect(stdout.some((l) => l.includes('no primary on record'))).toBe(false);
    const report = JSON.parse(readFileSync(join(dir, REPORT_OUTPUT_PATH), 'utf8'));
    expect(report.mcp.primaryMount).toBe('/api/public/mcp');
    expect(report.mcp.primaryUnreviewed).toBeUndefined();
    expect(report.mcp.serverCards).toEqual([
      { mount: '/api/public/mcp', path: expect.stringContaining('api-public-mcp.json') },
      { mount: '/api/mcp', path: expect.stringContaining('api-mcp.json') },
    ]);
    // The card check speaks to the written cards, not the mere mounts.
    const cardCheck = report.ora.checks.find((c: { id: string }) => c.id === 'mcp-server-card');
    expect(cardCheck).toMatchObject({ artifact: 'mcp-server-card', status: 'addressed' });

    // Each entry points at its own card: primary at the root, the gated one at its named slot.
    const catalog = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    const urls = catalog.entries
      .filter((e: { type: string }) => e.type === 'application/mcp-server-card+json')
      .map((e: { url: string }) => e.url)
      .sort();
    expect(urls).toEqual([
      'https://example.com/.well-known/mcp/server-card.json',
      'https://example.com/.well-known/mcp/server-card/api-mcp.json',
    ]);
  });

  it('named cards persist per-mount gating: the second build re-asks nothing', async () => {
    writeTwoMountFixture(dir);
    expect(await runCli(['--yes', '--report'], { ...io, cwd: dir })).toBe(0);

    // Interactive second run: both mounts and the primary are on record via the committed cards.
    stdout = [];
    const questions: string[] = [];
    const code = await runCli(['--report'], {
      ...io,
      cwd: dir,
      confirm: async (question: string) => {
        questions.push(question);
        return true;
      },
    });

    expect(code).toBe(0);
    expect(questions.some((q) => q.includes('public') || q.includes('primary'))).toBe(false);
    const report = JSON.parse(readFileSync(join(dir, REPORT_OUTPUT_PATH), 'utf8'));
    expect(report.mcp.unreviewedMounts).toEqual([]);
    expect(report.mcp.primaryUnreviewed).toBeUndefined();
    expect(report.mcp.primaryMount).toBe('/api/public/mcp');
  });

  it('never asks the primary question when exactly one server is public — even interactively', async () => {
    writeTwoMountFixture(dir);

    const questions: string[] = [];
    const code = await runCli([], {
      ...io,
      cwd: dir,
      confirm: async (question: string) => {
        questions.push(question);
        return true;
      },
    });

    expect(code).toBe(0);
    // The gating question runs (the public mount is unreviewed); the primary one never does.
    expect(questions.some((q) => q.includes('public'))).toBe(true);
    expect(questions.some((q) => q.includes('be the primary'))).toBe(false);
    const root = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(root.serverUrl).toBe('https://example.com/api/public/mcp');
  });

  it('asks the primary question at the gate (several public servers) and persists a non-default answer', async () => {
    // Two OPEN mounts: with several public servers the root-card owner is genuinely ambiguous,
    // so the gate asks. Modeled as /api/alpha/mcp + /api/beta/mcp, both un-wrapped.
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' }),
      'utf8',
    );
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );
    for (const name of ['alpha', 'beta']) {
      const mountDir = join(dir, 'app', 'api', name, 'mcp');
      mkdirSync(mountDir, { recursive: true });
      writeFileSync(
        join(mountDir, 'route.ts'),
        `import { createMcpHandler } from 'mcp-handler';\n` +
          `const handler = createMcpHandler((server) => { server.tool('${name}_tool', 'd', {}, async () => ({})); });\n` +
          `export { handler as GET };\n`,
        'utf8',
      );
    }

    const questions: string[] = [];
    const code = await runCli([], {
      ...io,
      cwd: dir,
      confirm: async (question: string) => {
        questions.push(question);
        // Gating: both public (yes). Primary: decline the default (alpha), accept beta.
        if (question.includes('be the primary')) return question.includes('at /api/beta/mcp be');
        return true;
      },
    });

    expect(code).toBe(0);
    expect(questions.filter((q) => q.includes('be the primary')).length).toBe(2);
    const root = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(root.serverUrl).toBe('https://example.com/api/beta/mcp');

    // The entry URLs follow the primary: beta's entry points at the root card, alpha's at its
    // named slot.
    const catalog = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    const urls = catalog.entries.map((e: { url: string }) => e.url).sort();
    expect(urls).toEqual([
      'https://example.com/.well-known/mcp/server-card.json',
      'https://example.com/.well-known/mcp/server-card/api-alpha-mcp.json',
    ]);

    // The next build sees the committed root card and keeps the choice without asking.
    stdout = [];
    const rerunQuestions: string[] = [];
    expect(
      await runCli([], {
        ...io,
        cwd: dir,
        confirm: async (question: string) => {
          rerunQuestions.push(question);
          return true;
        },
      }),
    ).toBe(0);
    expect(rerunQuestions.some((q) => q.includes('be the primary'))).toBe(false);
    const rebuilt = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(rebuilt.serverUrl).toBe('https://example.com/api/beta/mcp');
  });
});
