import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { GENERATED_BY } from '../src/markdown-artifact.js';
import type { BuildReport } from '../src/report.js';
import { CATALOG_OUTPUT_PATH } from '../src/write.js';

// End-to-end CLI coverage for the markdown-twin pass: the exposure summary shows the plan, the
// review gate covers a first twin publish, and the writes (twins, auth.md, manifest refresh,
// report, sizes) land only after it.

let dir: string;
let stdout: string[];
let stderr: string[];

const io = () => ({
  cwd: dir,
  stdout: (line: string) => stdout.push(line),
  stderr: (line: string) => stderr.push(line),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-cli-twins-'));
  stdout = [];
  stderr = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

const FILLER = 'Real page content that an agent would want to read, not chrome. '.repeat(5);

/** A minimal app with one prerendered route whose HTML clears every Tier-2 guard. */
function writeAppWithPrerender(): void {
  write('package.json', JSON.stringify({ name: 'demo' }));
  write('tsconfig.json', '{}');
  write('ax.config.ts', "export default { siteUrl: 'https://example.com' };\n");
  write('app/page.tsx', 'export default () => null;');
  write(
    '.next/server/app/index.html',
    `<html><head><title>Home</title></head><body><main><h1>Home</h1><p>${FILLER}</p></main></body></html>`,
  );
}

function readReport(): BuildReport {
  return JSON.parse(readFileSync(join(dir, '.ax', 'report.json'), 'utf8')) as BuildReport;
}

describe('runCli markdown twins', () => {
  it('shows twins in the exposure summary, writes them with --yes, and records them in the report', async () => {
    writeAppWithPrerender();
    const code = await runCli(['--yes', '--report'], io());
    expect(code).toBe(0);

    expect(stdout.some((l) => l.includes('Markdown twins → 1 page (/index.md)'))).toBe(true);
    const twin = readFileSync(join(dir, 'public', 'index.md'), 'utf8');
    expect(twin).toContain(`generated-by: "${GENERATED_BY}"`);
    expect(twin).toContain('# Home');

    const report = readReport();
    expect(report.markdownTwins.enabled).toBe(true);
    expect(report.markdownTwins.written).toMatchObject([
      { route: '/', path: join('public', 'index.md'), tier: 2, source: 'prerender' },
    ]);
    expect(report.sizes.some((s) => s.artifact === 'markdown-twin')).toBe(true);
    // Twins land as rows in the consolidated file tree, not a "✓ wrote 1 markdown twin" line.
    expect(
      stdout.some((l) =>
        l.includes('✓ Following artifacts generated (estimated tokens = chars ÷ 4):'),
      ),
    ).toBe(true);
    expect(stdout.some((l) => /index\.md — \d+ B \(~\d+ tokens\)/.test(l))).toBe(true);
  });

  it('gates the FIRST twin publish even when the catalog already exists', async () => {
    writeAppWithPrerender();
    write(CATALOG_OUTPUT_PATH, '{}'); // not a first catalog publish
    const code = await runCli([], { ...io(), confirm: async () => false });
    expect(code).toBe(1);
    expect(stdout.some((l) => l.includes('Aborted'))).toBe(true);
    expect(existsSync(join(dir, 'public', 'index.md'))).toBe(false);
  });

  it('re-runs with twins already generated stay unattended', async () => {
    writeAppWithPrerender();
    write(CATALOG_OUTPUT_PATH, '{}');
    write('public/index.md', `---\ntitle: "Home"\ngenerated-by: "${GENERATED_BY}"\n---\n\nold\n`);
    // No confirm injected and no --yes: a gate firing would fail the run in this non-TTY test env.
    const code = await runCli([], io());
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'public', 'index.md'), 'utf8')).not.toContain('old');
  });

  it('writes /auth.md when a gated surface exists and links it from the report', async () => {
    writeAppWithPrerender();
    write(
      'public/openapi.json',
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Acme API' },
        components: { securitySchemes: { key: { type: 'apiKey', name: 'x', in: 'header' } } },
      }),
    );
    const code = await runCli(['--yes', '--report'], io());
    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('Auth guide → /auth.md (1 gated surface)'))).toBe(true);
    const authMd = readFileSync(join(dir, 'public', 'auth.md'), 'utf8');
    expect(authMd).toContain('API key');
    expect(readReport().markdownTwins.authMd).toMatchObject({
      path: join('public', 'auth.md'),
      surfaceCount: 1,
    });
  });

  it('refreshes an existing serving manifest after the twins land', async () => {
    writeAppWithPrerender();
    write('ax-manifest.ts', 'export const axManifest = {} as const;\n');
    const code = await runCli(['--yes'], io());
    expect(code).toBe(0);
    // The manifest refresh lands as a tree row now, not a standalone "refreshed ax-manifest.ts" line.
    expect(stdout.some((l) => l.includes('ax-manifest.ts — serving manifest (refreshed)'))).toBe(
      true,
    );
    // The refresh sees the twin this same run just wrote.
    expect(readFileSync(join(dir, 'ax-manifest.ts'), 'utf8')).toContain('"/index.md"');
  });

  it('never creates a manifest module a project did not opt into', async () => {
    writeAppWithPrerender();
    const code = await runCli(['--yes'], io());
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'ax-manifest.ts'))).toBe(false);
  });

  it('markdownTwins: false writes nothing and reports the pass as disabled', async () => {
    writeAppWithPrerender();
    write(
      'ax.config.ts',
      "export default { siteUrl: 'https://example.com', markdownTwins: false };\n",
    );
    const code = await runCli(['--yes', '--report'], io());
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'public', 'index.md'))).toBe(false);
    expect(readReport().markdownTwins).toMatchObject({ enabled: false, written: [] });
  });
});

describe('ax manifest subcommand', () => {
  it('writes the manifest module and prints the counts', async () => {
    writeAppWithPrerender();
    write('public/index.md', '# hand-written home twin\n');
    const code = await runCli(['manifest'], io());
    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('✓ wrote ax-manifest.ts'))).toBe(true);
    expect(stdout.some((l) => l.includes('1 markdown twin'))).toBe(true);
    const module = readFileSync(join(dir, 'ax-manifest.ts'), 'utf8');
    expect(module).toContain('"basePath": ""');
    expect(module).toContain('"/": "/index.md"');
  });

  it('fails loudly on an invalid ax.config, like a build', async () => {
    write('package.json', JSON.stringify({ name: 'demo' }));
    write('ax.config.ts', 'export default { unknownKey: 1 };\n');
    const code = await runCli(['manifest'], io());
    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('ax.config.ts'))).toBe(true);
  });
});
