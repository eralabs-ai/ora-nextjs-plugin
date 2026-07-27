import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { CATALOG_OUTPUT_PATH, REPORT_OUTPUT_PATH, SERVER_CARD_OUTPUT_PATH } from '../src/write.js';

/** Writes a minimal app with a single mcp-handler mount and a configured siteUrl. */
function writeMcpFixture(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0' }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'ard.config.mjs'),
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

let dir: string;
let stdout: string[];
let stderr: string[];
const io = {
  stdout: (line: string) => stdout.push(line),
  stderr: (line: string) => stderr.push(line),
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

  it('accepts a relative --cwd and still loads ard.config from it', async () => {
    writeFileSync(
      join(dir, 'ard.config.mjs'),
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

  it('exits 1 with an actionable message and writes nothing on an invalid ard.config', async () => {
    writeFileSync(join(dir, 'ard.config.mjs'), 'export default { denylist: 123 };\n', 'utf8');

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('ard.config'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('warns (but still succeeds) when next.config sets basePath', async () => {
    writeFileSync(join(dir, 'next.config.mjs'), "export default { basePath: '/app' };\n", 'utf8');

    const code = await runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('basePath'))).toBe(true);
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
      reportVersion: 1,
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
      webmcp: { toolNames: [], sites: [] },
    });
    // Every detect-and-recommend artifact reports presence; this fixture has none of them.
    expect(report.artifacts.robotsTxt).toEqual({ found: false });
    expect(report.artifacts.llmsTxt).toEqual({ found: false });
    // The report mirrors the printed channels verbatim.
    expect(Array.isArray(report.warnings)).toBe(true);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(stdout.some((l) => l.includes('machine-readable build report'))).toBe(true);
  });

  it('--report=<path> writes to a custom path', async () => {
    writeMcpFixture(dir);

    const code = await runCli(['--report=agent-report.json'], { ...io, cwd: dir });
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'agent-report.json'))).toBe(true);
  });

  it('ard.config `report: true` enables the report without a CLI flag', async () => {
    // A separate tmp dir (not a rewrite of this test file's shared config): Node's native ESM
    // cache means the same ard.config.mjs path is only evaluated once per process, and unlike a
    // real CLI run the test suite is one long-lived process.
    const configDir = mkdtempSync(join(tmpdir(), 'ax-cli-report-'));
    try {
      writeFileSync(join(configDir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
      writeFileSync(
        join(configDir, 'ard.config.mjs'),
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
