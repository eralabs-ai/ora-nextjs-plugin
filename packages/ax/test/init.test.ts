import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { loadAxConfig } from '../src/config.js';
import { runInit, validateSiteUrl } from '../src/init.js';
import type { MultiSelectChoice, Prompter } from '../src/prompt.js';
import { CATALOG_OUTPUT_PATH } from '../src/write.js';

/** A prompter driven by scripted answers, so the wizard runs with no TTY. */
class ScriptedPrompter implements Prompter {
  private ti = 0;
  private ci = 0;
  private mi = 0;
  constructor(
    private readonly scripted: {
      text?: string[];
      confirm?: boolean[];
      multiSelect?: string[][];
    },
  ) {}
  async text(_question: string, defaultValue?: string): Promise<string> {
    return this.scripted.text?.[this.ti++] ?? defaultValue ?? '';
  }
  async confirm(_question: string, defaultValue: boolean): Promise<boolean> {
    return this.scripted.confirm?.[this.ci++] ?? defaultValue;
  }
  async multiSelect(_question: string, choices: MultiSelectChoice[]): Promise<string[]> {
    return (
      this.scripted.multiSelect?.[this.mi++] ??
      choices.filter((choice) => choice.selected).map((choice) => choice.value)
    );
  }
}

/** A minimal-but-real TypeScript Next.js app, the shape `ax init` runs against. */
function writeBareApp(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'demo', scripts: { build: 'next build' } }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(join(dir, 'tsconfig.json'), '{}\n', 'utf8');
  writeFileSync(join(dir, 'next.config.mjs'), 'export default {};\n', 'utf8');
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'app', 'page.tsx'),
    'export default function Page() {\n  return <main>Home</main>;\n}\n',
    'utf8',
  );
}

/** Adds an mcp-handler mount at /mcp, so the gated-surface multi-select has a real candidate. */
function addMcpMount(dir: string): void {
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
const io = () => ({
  cwd: dir,
  stdout: (line: string) => stdout.push(line),
  stderr: (line: string) => stderr.push(line),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-init-'));
  stdout = [];
  stderr = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('validateSiteUrl', () => {
  it('accepts an https origin and normalizes it to scheme + host', () => {
    expect(validateSiteUrl('https://example.com')).toEqual({
      ok: true,
      value: 'https://example.com',
    });
    expect(validateSiteUrl('https://example.com/docs?x=1')).toEqual({
      ok: true,
      value: 'https://example.com',
    });
    expect(validateSiteUrl('  https://Example.com  ')).toEqual({
      ok: true,
      value: 'https://example.com',
    });
  });

  it('refuses non-https, localhost, loopback, and TLD-less hosts', () => {
    for (const bad of [
      '',
      'not a url',
      'http://example.com',
      'https://localhost',
      'https://localhost:3000',
      'https://127.0.0.1',
      'https://myapp',
      'https://demo.local',
      // Trailing-dot forms of the loopback hosts must not slip past the equality checks.
      'https://localhost.',
      'https://127.0.0.1.',
    ]) {
      expect(validateSiteUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe('runInit --yes (non-interactive)', () => {
  it('writes ax.config.ts and wires postbuild from flags alone', async () => {
    writeBareApp(dir);

    const code = await runInit(['--yes', '--site-url', 'https://acme.com'], io());

    expect(code).toBe(0);
    const configPath = join(dir, 'ax.config.ts');
    expect(existsSync(configPath)).toBe(true);
    const source = readFileSync(configPath, 'utf8');
    expect(source).toContain('siteUrl: "https://acme.com"');
    // Scaffolds default on when asked; the floor-only default omits isGated.
    expect(source).toContain('scaffoldLlmsTxt: true,');
    expect(source).not.toContain('isGated');

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.scripts.postbuild).toBe('ax');
  });

  it('resolves the site URL from SITE_URL when no flag is given', async () => {
    writeBareApp(dir);
    const previous = process.env.SITE_URL;
    process.env.SITE_URL = 'https://from-env.com';
    try {
      const code = await runInit(['--yes'], io());
      expect(code).toBe(0);
      expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).toContain(
        'siteUrl: "https://from-env.com"',
      );
    } finally {
      if (previous === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = previous;
    }
  });

  it('exits non-zero with a clear message when --yes has no site URL', async () => {
    writeBareApp(dir);
    const previous = process.env.SITE_URL;
    const previousPublic = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    try {
      const code = await runInit(['--yes'], io());
      expect(code).toBe(1);
      expect(stderr.some((l) => l.includes('--site-url'))).toBe(true);
      expect(existsSync(join(dir, 'ax.config.ts'))).toBe(false);
    } finally {
      if (previous !== undefined) process.env.SITE_URL = previous;
      if (previousPublic !== undefined) process.env.NEXT_PUBLIC_SITE_URL = previousPublic;
    }
  });

  it('refuses a localhost site URL even headless, and writes nothing', async () => {
    writeBareApp(dir);
    const code = await runInit(['--yes', '--site-url', 'http://localhost:3000'], io());
    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('local or preview') || l.includes('https'))).toBe(true);
    expect(existsSync(join(dir, 'ax.config.ts'))).toBe(false);
  });
});

describe('runInit never overwrites', () => {
  it('aborts, pointing at the existing config, without touching it', async () => {
    writeBareApp(dir);
    const configPath = join(dir, 'ax.config.mjs');
    writeFileSync(configPath, "export default { siteUrl: 'https://kept.com' };\n", 'utf8');

    const code = await runInit(['--yes', '--site-url', 'https://acme.com'], io());

    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('already exists'))).toBe(true);
    // The existing file is untouched and no new ax.config.ts was written.
    expect(readFileSync(configPath, 'utf8')).toContain('https://kept.com');
    expect(existsSync(join(dir, 'ax.config.ts'))).toBe(false);
  });

  // Decision: findExistingConfig (deliberately simplified to look only for ax.config.*) reports an
  // ard.config.*-only project as unconfigured, so the never-overwrite guard above doesn't catch it.
  // But detection right after that guard reuses generateCatalog, which throws AxConfigError for
  // exactly this project shape (see config.ts) — so init still refuses, just via that error path
  // instead of the "already exists" guard, and with the same rename message a build would show.
  // Proceeding to write a fresh ax.config.ts next to the broken ard.config.* was considered and
  // rejected: it would leave the stale file behind with no signal that it's now dead weight, and
  // silently fixing only half the project (new config, but the old one still there confusing the
  // next reader) is worse than telling the developer to rename it up front.
  it('refuses when only a legacy ard.config exists, surfacing the same rename message a build would', async () => {
    writeBareApp(dir);
    const legacyPath = join(dir, 'ard.config.mjs');
    writeFileSync(legacyPath, "export default { siteUrl: 'https://legacy.com' };\n", 'utf8');

    const code = await runInit(['--yes', '--site-url', 'https://acme.com'], io());

    expect(code).toBe(1);
    expect(stderr.some((l) => l.toLowerCase().includes('rename it to ax.config.mjs'))).toBe(true);
    expect(readFileSync(legacyPath, 'utf8')).toContain('https://legacy.com');
    expect(existsSync(join(dir, 'ax.config.ts'))).toBe(false);
  });
});

describe('runInit package.json wiring edge cases', () => {
  it('does not clobber its own insertion when a blank postbuild sits after build', async () => {
    writeBareApp(dir);
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'demo', scripts: { build: 'next build', postbuild: '' } }, null, 2)}\n`,
      'utf8',
    );

    expect(await runInit(['--yes', '--site-url', 'https://acme.com'], io())).toBe(0);

    const scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts;
    expect(scripts.postbuild).toBe('ax');
  });

  it('refuses to touch a malformed non-object scripts field', async () => {
    writeBareApp(dir);
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'demo', scripts: 'ax' }, null, 2)}\n`,
      'utf8',
    );

    const code = await runInit(['--yes', '--site-url', 'https://acme.com'], io());

    // Config still written, but the malformed scripts is left intact (no character-index corruption).
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'ax.config.ts'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts).toBe('ax');
    expect(stdout.some((l) => l.includes('not an object'))).toBe(true);
  });
});

describe('runInit gated-surface candidates respect basePath', () => {
  it('offers and writes the basePath-prefixed served path, matching runtime target.path', async () => {
    writeBareApp(dir);
    writeFileSync(join(dir, 'next.config.mjs'), "export default { basePath: '/app' };\n", 'utf8');
    addMcpMount(dir);

    const offered: MultiSelectChoice[] = [];
    const prompter: Prompter = {
      text: async () => 'https://acme.com',
      confirm: async () => false,
      multiSelect: async (_question, choices) => {
        offered.push(...choices);
        return choices.map((choice) => choice.value); // gate everything offered
      },
    };

    expect(await runInit([], { ...io(), prompter })).toBe(0);

    // The MCP candidate is offered as the basePath-prefixed served path, not the raw router path.
    expect(offered.some((c) => c.value === '/app/mcp')).toBe(true);
    expect(offered.some((c) => c.value === '/mcp')).toBe(false);
    // And that prefixed path is what lands in the generated isGated matcher.
    expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).toContain('"/app/mcp"');
  });
});

describe('runInit interactive (scripted answers)', () => {
  it('captures the answers: gated MCP mount, scaffolds off, into the generated config', async () => {
    writeBareApp(dir);
    addMcpMount(dir);

    const prompter = new ScriptedPrompter({
      text: ['https://acme.com'],
      // Drop the floor, gate the detected /mcp mount.
      multiSelect: [['/mcp']],
      // scaffoldLlmsTxt, JsonLd, Robots, Agent404, report, run-build — all no.
      confirm: [false, false, false, false, false, false],
    });

    const code = await runInit([], { ...io(), prompter });

    expect(code).toBe(0);
    const source = readFileSync(join(dir, 'ax.config.ts'), 'utf8');
    expect(source).toContain('siteUrl: "https://acme.com"');
    expect(source).toContain('scaffoldLlmsTxt: false,');
    expect(source).toContain('report: false,');
    expect(source).toContain('isGated: (target) => ["/mcp"].includes(target.path),');
    // The findings summary ran before any question.
    expect(stdout.some((l) => l.includes('Scanned your project'))).toBe(true);
  });

  it('re-prompts on an invalid site URL, then accepts a valid one', async () => {
    writeBareApp(dir);
    const prompter = new ScriptedPrompter({
      text: ['http://localhost:3000', 'https://acme.com'],
      confirm: [true, true, true, true, true, false],
    });

    const code = await runInit([], { ...io(), prompter });

    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('local or preview') || l.includes('https'))).toBe(true);
    expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).toContain(
      'siteUrl: "https://acme.com"',
    );
  });

  it('offers to run the build and honors a yes via the injected build runner', async () => {
    writeBareApp(dir);
    let built = 0;
    const prompter = new ScriptedPrompter({
      text: ['https://acme.com'],
      confirm: [true, true, true, true, true, true], // last = run build
    });

    const code = await runInit([], {
      ...io(),
      prompter,
      spawnBuild: async () => {
        built++;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(built).toBe(1);
  });
});

describe('runInit round-trip', () => {
  it('produces a config that loads+validates and drives a successful subsequent build', async () => {
    writeBareApp(dir);

    // 1. init headless.
    expect(await runInit(['--yes', '--site-url', 'https://example.com'], io())).toBe(0);

    // 2. the generated ax.config.ts loads through the real jiti path and validates.
    const loaded = await loadAxConfig(dir);
    expect(loaded.path).toBe(join(dir, 'ax.config.ts'));
    expect(loaded.config.siteUrl).toBe('https://example.com');
    expect(loaded.config.scaffoldLlmsTxt).toBe(true);
    expect(loaded.config.report).toBe(true);

    // 3. a subsequent `ax` build succeeds and the review gate sees the wizard's siteUrl choice.
    stdout = [];
    const code = await runCli([], {
      cwd: dir,
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
      confirm: async () => true,
    });
    expect(code).toBe(0);
    const catalog = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    expect(catalog.host.identifier).toBe('did:web:example.com');
    // The wizard opted into the report, so the build wrote one without a CLI flag.
    expect(existsSync(join(dir, '.ora', 'report.json'))).toBe(true);
  });
});

describe('ax init via runCli subcommand', () => {
  it('routes `ax init` to the wizard', async () => {
    writeBareApp(dir);
    const code = await runCli(['init', '--yes', '--site-url', 'https://acme.com'], {
      cwd: dir,
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'ax.config.ts'))).toBe(true);
  });
});
