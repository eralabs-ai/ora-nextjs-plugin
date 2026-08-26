import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { loadAxConfig } from '../src/config.js';
import { runInit, validateSiteUrl } from '../src/init.js';
import {
  isMultiSelectChoice,
  type MultiSelectChoice,
  type MultiSelectRow,
  type Prompter,
} from '../src/prompt.js';
import { CATALOG_OUTPUT_PATH } from '../src/write.js';

/** A prompter driven by scripted answers, so the wizard runs with no TTY. */
class ScriptedPrompter implements Prompter {
  private ti = 0;
  private ci = 0;
  private mi = 0;
  private si = 0;
  constructor(
    private readonly scripted: {
      text?: string[];
      confirm?: boolean[];
      multiSelect?: string[][];
      select?: string[];
    },
  ) {}
  async text(_question: string, defaultValue?: string): Promise<string> {
    return this.scripted.text?.[this.ti++] ?? defaultValue ?? '';
  }
  async confirm(_question: string, defaultValue: boolean): Promise<boolean> {
    return this.scripted.confirm?.[this.ci++] ?? defaultValue;
  }
  async multiSelect(_question: string, rows: MultiSelectRow[]): Promise<string[]> {
    return (
      this.scripted.multiSelect?.[this.mi++] ??
      rows
        .filter(isMultiSelectChoice)
        .filter((choice) => choice.selected)
        .map((choice) => choice.value)
    );
  }
  async select(_question: string, rows: MultiSelectRow[]): Promise<string | undefined> {
    return (
      this.scripted.select?.[this.si++] ??
      rows.filter(isMultiSelectChoice).find((choice) => choice.selected)?.value
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

describe('runInit gating respects basePath', () => {
  it('shows the basePath-prefixed served path and writes the card with the prefixed serverUrl', async () => {
    writeBareApp(dir);
    writeFileSync(join(dir, 'next.config.mjs'), "export default { basePath: '/app' };\n", 'utf8');
    addMcpMount(dir);

    const offered: MultiSelectChoice[] = [];
    const prompter: Prompter = {
      text: async () => 'https://acme.com',
      confirm: async () => false,
      // Select nothing as public → the server is gated.
      multiSelect: async (_question, rows) => {
        offered.push(...rows.filter(isMultiSelectChoice));
        return [];
      },
      select: async (_question, rows) =>
        rows.filter(isMultiSelectChoice).find((choice) => choice.selected)?.value,
    };

    expect(await runInit([], { ...io(), prompter })).toBe(0);

    // The label shows the served (basePath-prefixed) path — what an agent would actually fetch.
    expect(offered.some((c) => c.label.includes('/app/mcp'))).toBe(true);
    // The gated decision lands in the server card, with the prefixed serverUrl.
    const card = JSON.parse(
      readFileSync(join(dir, 'public', '.well-known', 'mcp', 'server-card.json'), 'utf8'),
    );
    expect(card.serverUrl).toBe('https://acme.com/app/mcp');
    expect(card.authentication).toEqual({ required: true });
    // A single card prints its own "✓ wrote <path>" line — the "✓ wrote N MCP server cards"
    // one-liner is reserved for multi-card runs (see the multi-mount describe block below).
    expect(stdout.some((l) => /✓ wrote \d+ MCP server cards/.test(l))).toBe(false);
  });
});

describe('runInit multi-mount primary question', () => {
  /** Two mounts: an open /api/public/mcp and a withMcpAuth-gated /api/mcp. */
  function addTwoMounts(dir: string): void {
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

  /** Adds a second OPEN mount at /api/tools/mcp — with it, two servers are public. */
  function addSecondPublicMount(dir: string): void {
    const toolsDir = join(dir, 'app', 'api', 'tools', 'mcp');
    mkdirSync(toolsDir, { recursive: true });
    writeFileSync(
      join(toolsDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => { server.tool('lookup', 'd', {}, async () => ({})); });\n` +
        `export { handler as GET };\n`,
      'utf8',
    );
  }

  it('auto-picks the sole public server as primary without asking', async () => {
    writeBareApp(dir);
    addTwoMounts(dir);

    let primaryQuestions = 0;
    const prompter: Prompter = {
      text: async () => 'https://acme.com',
      confirm: async () => false,
      // Accept the gating pre-selection: the public mount stays public, withMcpAuth stays gated.
      multiSelect: async (_question, rows) =>
        rows
          .filter(isMultiSelectChoice)
          .filter((choice) => choice.selected)
          .map((choice) => choice.value),
      // The gated mount's auth-scheme question also arrives here — answer undefined (= skip);
      // this test is about the primary question specifically.
      select: async (question) => {
        if (question.includes('PRIMARY')) primaryQuestions++;
        return undefined;
      },
    };

    expect(await runInit([], { ...io(), prompter })).toBe(0);

    // Exactly one public server → it is the primary, silently: no question asked.
    expect(primaryQuestions).toBe(0);
    expect(
      stdout.some((l) => l.includes('Primary MCP server: /api/public/mcp') && l.includes('public')),
    ).toBe(true);

    // Root card = the primary (public) server; every server has its named slot.
    const root = JSON.parse(
      readFileSync(join(dir, 'public', '.well-known', 'mcp', 'server-card.json'), 'utf8'),
    );
    expect(root.serverUrl).toBe('https://acme.com/api/public/mcp');
    const namedDir = join(dir, 'public', '.well-known', 'mcp', 'server-card');
    const gated = JSON.parse(readFileSync(join(namedDir, 'api-mcp.json'), 'utf8'));
    expect(gated.authentication).toEqual({ required: true });
    expect(existsSync(join(namedDir, 'api-public-mcp.json'))).toBe(true);

    // Multiple cards land in one run, so the printed output is a single "✓ wrote N MCP server
    // cards" line naming the primary — not a tree, and not a line per card (the build's own
    // artifact tree shows their full shape minutes later).
    expect(
      stdout.some((l) => l.includes('✓ wrote 3 MCP server cards (primary: /api/public/mcp)')),
    ).toBe(true);
    // The completion line is unconditional and no longer mentions ax.config — the build's own
    // output is where the per-artifact detail (and the commit-the-cards CTA) now lives.
    expect(stdout.some((l) => l.includes('✓ All set — your site is ready to meet agents.'))).toBe(
      true,
    );
  });

  it('asks (server rows only, first public default) when several servers are public', async () => {
    writeBareApp(dir);
    addTwoMounts(dir);
    addSecondPublicMount(dir);

    const selectRows: MultiSelectRow[] = [];
    const selectQuestions: string[] = [];
    const prompter: Prompter = {
      text: async () => 'https://acme.com',
      confirm: async () => false,
      multiSelect: async (_question, rows) =>
        rows
          .filter(isMultiSelectChoice)
          .filter((choice) => choice.selected)
          .map((choice) => choice.value),
      select: async (question, rows) => {
        selectQuestions.push(question);
        // Capture only the primary question's rows — the gated mount's auth-scheme select (asked
        // later, and answered "skip" here via its default-less undefined) has its own rows.
        if (question.includes('PRIMARY')) selectRows.push(...rows);
        return question.includes('PRIMARY')
          ? rows.filter(isMultiSelectChoice).find((choice) => choice.selected)?.value
          : undefined;
      },
    };

    expect(await runInit([], { ...io(), prompter })).toBe(0);

    // Two public servers → ambiguous, so the question runs. It lists only the MCP server rows
    // (the gating question just showed the full tree — repeating it would be noise), defaults to
    // the first public one, and annotates the gated row with the gating answer.
    expect(selectQuestions[0]).toBe(
      'Which MCP server is the PRIMARY (the path agents probe first)?',
    );
    expect(selectRows.every(isMultiSelectChoice)).toBe(true);
    const choices = selectRows.filter(isMultiSelectChoice);
    expect(choices.map((c) => c.value)).toEqual(['/api/mcp', '/api/public/mcp', '/api/tools/mcp']);
    expect(choices.find((c) => c.selected)?.value).toBe('/api/public/mcp');
    expect(choices.find((c) => c.value === '/api/mcp')?.label).toContain('requires login');
    expect(choices.find((c) => c.value === '/api/public/mcp')?.label).not.toContain(
      'requires login',
    );

    const root = JSON.parse(
      readFileSync(join(dir, 'public', '.well-known', 'mcp', 'server-card.json'), 'utf8'),
    );
    expect(root.serverUrl).toBe('https://acme.com/api/public/mcp');
  });

  it('records a chosen non-default primary in the root card', async () => {
    writeBareApp(dir);
    addTwoMounts(dir);
    addSecondPublicMount(dir);

    const prompter = new ScriptedPrompter({
      text: ['https://acme.com'],
      // Gating and setup multi-selects both fall back to accepting whatever's pre-selected; only
      // the build offer remains a confirm, and this test doesn't care about its answer.
      confirm: [false],
      select: ['/api/tools/mcp'],
    });

    expect(await runInit([], { ...io(), prompter })).toBe(0);

    const root = JSON.parse(
      readFileSync(join(dir, 'public', '.well-known', 'mcp', 'server-card.json'), 'utf8'),
    );
    expect(root.serverUrl).toBe('https://acme.com/api/tools/mcp');
    expect(root.authentication).toBeUndefined();
  });

  it('skips the primary question entirely for a single mount', async () => {
    writeBareApp(dir);
    addMcpMount(dir);

    let selectCalls = 0;
    const prompter: Prompter = {
      text: async () => 'https://acme.com',
      confirm: async () => false,
      multiSelect: async (_question, rows) =>
        rows
          .filter(isMultiSelectChoice)
          .filter((choice) => choice.selected)
          .map((choice) => choice.value),
      select: async () => {
        selectCalls++;
        return undefined;
      },
    };

    expect(await runInit([], { ...io(), prompter })).toBe(0);
    expect(selectCalls).toBe(0);
    // Single mount: root card only, no named directory.
    expect(existsSync(join(dir, 'public', '.well-known', 'mcp', 'server-card.json'))).toBe(true);
    expect(existsSync(join(dir, 'public', '.well-known', 'mcp', 'server-card'))).toBe(false);
  });
});

describe('runInit interactive (scripted answers)', () => {
  it('records a gated MCP server in the card, never in the config, with the tree shown first', async () => {
    writeBareApp(dir);
    addMcpMount(dir);

    const prompter = new ScriptedPrompter({
      text: ['https://acme.com'],
      // Two multi-selects in order: gating (select nothing as public → the server is gated; the
      // built-in floor always applies anyway), then setup (decline everything).
      multiSelect: [[], []],
      // Only the build offer remains a confirm.
      confirm: [false],
    });

    const code = await runInit([], { ...io(), prompter });

    expect(code).toBe(0);
    const source = readFileSync(join(dir, 'ax.config.ts'), 'utf8');
    expect(source).toContain('siteUrl: "https://acme.com"');
    expect(source).toContain('scaffoldLlmsTxt: false,');
    expect(source).toContain('report: false,');
    // The gating decision is persisted in the server card — the config carries no isGated.
    expect(source).not.toContain('isGated');
    const card = JSON.parse(
      readFileSync(join(dir, 'public', '.well-known', 'mcp', 'server-card.json'), 'utf8'),
    );
    expect(card.serverUrl).toBe('https://acme.com/mcp');
    expect(card.authentication).toEqual({ required: true });
    expect(card.tools).toEqual([{ name: 'roll_dice' }]);
    // The gating summary spells out the decision in plain language.
    expect(
      stdout.some(
        (l) => l.includes('Requires login (not advertised as open)') && l.includes('/mcp'),
      ),
    ).toBe(true);
    // The findings summary ran before any question. Interactively the route tree is not printed
    // here — it renders *as* the gating prompt (checkbox on the server node), so it would appear
    // twice otherwise. (The rows are asserted in the tree-prompt test below.)
    expect(stdout.some((l) => l.includes('Scanned your project'))).toBe(true);
    expect(stdout.some((l) => l.includes('Route ('))).toBe(false);
  });

  it('offers one choice per MCP server with its tools as leaves in the label', async () => {
    writeBareApp(dir);
    const routeDir = join(dir, 'app', 'api', 'mcp');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => {\n` +
        `  server.tool('search_flights', 'd', {}, async () => ({}));\n` +
        `  server.tool('pay', 'd', {}, async () => ({}));\n` +
        `});\n` +
        `export { handler as GET };\n`,
      'utf8',
    );

    const offeredRows: MultiSelectRow[] = [];
    const prompter: Prompter = {
      text: async () => 'https://acme.com',
      confirm: async () => false,
      // Accept the pre-selection (a plain mount starts public). Only capture the gating call's
      // rows — the setup multi-select (asked right after) offers its own unrelated seven rows, and
      // this test is about the gating prompt's shape, not the setup one.
      multiSelect: async (question, rows) => {
        if (!question.startsWith('What should ax set up?')) offeredRows.push(...rows);
        return rows
          .filter(isMultiSelectChoice)
          .filter((choice) => choice.selected)
          .map((choice) => choice.value);
      },
      select: async (_question, rows) =>
        rows.filter(isMultiSelectChoice).find((choice) => choice.selected)?.value,
    };

    expect(await runInit([], { ...io(), prompter })).toBe(0);

    // The prompt is the route tree: the server node is the one selectable row, its tools (and the
    // other routes) render as display-only rows around it.
    const offered = offeredRows.filter(isMultiSelectChoice);
    expect(offered).toHaveLength(1);
    expect(offered[0]?.value).toBe('/api/mcp');
    expect(offered[0]?.selected).toBe(true);
    expect(offered[0]?.label).toContain('ƒ /api/mcp');
    const displayTexts = offeredRows.flatMap((row) => ('text' in row ? [row.text] : []));
    expect(displayTexts.some((t) => t.includes('⚙ search_flights'))).toBe(true);
    expect(displayTexts.some((t) => t.includes('⚙ pay'))).toBe(true);
    expect(displayTexts.some((t) => t.includes('○ /'))).toBe(true);
    // Accepted as public → the card records it with no authentication block.
    const card = JSON.parse(
      readFileSync(join(dir, 'public', '.well-known', 'mcp', 'server-card.json'), 'utf8'),
    );
    expect(card.authentication).toBeUndefined();
    expect(
      stdout.some((l) => l.includes('Public (advertised to agents)') && l.includes('/api/mcp')),
    ).toBe(true);
  });

  it('pre-deselects a withMcpAuth-wrapped mount (its code already demands auth)', async () => {
    writeBareApp(dir);
    const routeDir = join(dir, 'app', 'api', 'mcp');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => { server.tool('search', 'd', {}, async () => ({})); });\n` +
        `const auth = withMcpAuth(handler, async () => undefined);\n` +
        `export { auth as GET };\n`,
      'utf8',
    );

    const offered: MultiSelectChoice[] = [];
    const prompter: Prompter = {
      text: async () => 'https://acme.com',
      confirm: async () => false,
      multiSelect: async (_question, rows) => {
        const choices = rows.filter(isMultiSelectChoice);
        offered.push(...choices);
        return choices.filter((choice) => choice.selected).map((choice) => choice.value);
      },
      select: async (_question, rows) =>
        rows.filter(isMultiSelectChoice).find((choice) => choice.selected)?.value,
    };

    expect(await runInit([], { ...io(), prompter })).toBe(0);
    expect(offered.find((c) => c.value === '/api/mcp')?.selected).toBe(false);
    const card = JSON.parse(
      readFileSync(join(dir, 'public', '.well-known', 'mcp', 'server-card.json'), 'utf8'),
    );
    expect(card.authentication).toEqual({ required: true });
  });

  it('prefills the site URL from an env var, naming the source in the one-line question', async () => {
    writeBareApp(dir);
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://envsite.com';
    try {
      const questions: string[] = [];
      const prompter: Prompter = {
        // Accept the prefilled default, capturing the question text.
        text: async (question, defaultValue) => {
          questions.push(question);
          return defaultValue ?? '';
        },
        confirm: async () => false,
        multiSelect: async () => [],
        select: async (_question, rows) =>
          rows.filter(isMultiSelectChoice).find((choice) => choice.selected)?.value,
      };
      const code = await runInit([], { ...io(), prompter });
      expect(code).toBe(0);
      expect(
        questions.some(
          (q) =>
            q.includes('prefilled from NEXT_PUBLIC_SITE_URL') &&
            q.includes('press Enter to approve'),
        ),
      ).toBe(true);
      expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).toContain(
        'siteUrl: "https://envsite.com"',
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = previous;
    }
  });

  it('re-prompts on an invalid site URL, then accepts a valid one', async () => {
    writeBareApp(dir);
    const prompter = new ScriptedPrompter({
      text: ['http://localhost:3000', 'https://acme.com'],
      // No MCP mount here, so the only confirm left is the build offer — decline it.
      confirm: [false],
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
      confirm: [true], // the only confirm left is the build offer
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

  // The regression CI missed: a normal run that gates *nothing* must leave the MCP mount published.
  // Previously only the "gated → dropped" path was tested, so an empty catalog looked acceptable.
  it('a default run gates nothing and the built catalog keeps the MCP entry', async () => {
    writeBareApp(dir);
    addMcpMount(dir);

    // Press Enter at gating (accept the pre-selection: roll_dice looks public, so it stays
    // selected) → nothing gated → no isGated written.
    const prompter = new ScriptedPrompter({
      text: ['https://acme.com'],
      confirm: [false],
    });
    expect(await runInit([], { ...io(), prompter })).toBe(0);
    expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).not.toContain('isGated');

    stdout = [];
    const code = await runCli([], {
      cwd: dir,
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
      confirm: async () => true,
    });
    expect(code).toBe(0);
    const catalog = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(
      catalog.entries.some((e: { identifier: string }) => e.identifier.includes('mcp-server')),
    ).toBe(true);
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

describe('runInit markdown twins + serving-manifest wiring', () => {
  it('--yes writes markdownTwins, wires prebuild before build, and creates the manifest module', async () => {
    writeBareApp(dir);
    const code = await runInit(['--yes', '--site-url', 'https://acme.com'], io());
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).toContain('markdownTwins: true,');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prebuild).toBe('ax manifest');
    expect(pkg.scripts.postbuild).toBe('ax');
    // prebuild reads before build, postbuild after it — the three tell the story in order.
    expect(Object.keys(pkg.scripts)).toEqual(['prebuild', 'build', 'postbuild']);
    expect(existsSync(join(dir, 'ax-manifest.ts'))).toBe(true);
    expect(readFileSync(join(dir, 'ax-manifest.ts'), 'utf8')).toContain('export const axManifest');
  });

  it('declining the twin and manifest questions writes markdownTwins: false and wires no prebuild', async () => {
    writeBareApp(dir);
    // Setup order: llmsTxt, jsonLd, robots, agent404, markdownTwins, report, manifest — deselect
    // markdownTwins and manifest, keep the rest. Only the build offer remains a confirm.
    const prompter = new ScriptedPrompter({
      text: ['https://acme.com'],
      multiSelect: [['llmsTxt', 'jsonLd', 'robots', 'agent404', 'report']],
      confirm: [false],
    });
    const code = await runInit([], { ...io(), prompter });
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).toContain('markdownTwins: false,');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prebuild).toBeUndefined();
    expect(existsSync(join(dir, 'ax-manifest.ts'))).toBe(false);
    expect(existsSync(join(dir, 'ax-manifest.js'))).toBe(false);
  });
});

describe('runInit setup multi-select', () => {
  it('maps a deselected subset to InitAnswers and wireManifest, leaving the rest at their default', async () => {
    writeBareApp(dir);
    // Deselect only jsonLd and manifest; everything else in SETUP_OPTIONS stays selected.
    const prompter = new ScriptedPrompter({
      text: ['https://acme.com'],
      multiSelect: [['llmsTxt', 'robots', 'agent404', 'markdownTwins', 'report']],
      confirm: [false],
    });

    const code = await runInit([], { ...io(), prompter });

    expect(code).toBe(0);
    const source = readFileSync(join(dir, 'ax.config.ts'), 'utf8');
    expect(source).toContain('scaffoldJsonLd: false,');
    expect(source).toContain('scaffoldLlmsTxt: true,');
    expect(source).toContain('scaffoldRobots: true,');
    expect(source).toContain('scaffoldAgent404: true,');
    expect(source).toContain('markdownTwins: true,');
    expect(source).toContain('report: true,');

    // manifest deselected → no prebuild wired, but the postbuild script is still added.
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prebuild).toBeUndefined();
    expect(pkg.scripts.postbuild).toBe('ax');
    expect(existsSync(join(dir, 'ax-manifest.ts'))).toBe(false);
  });
});

describe('auth-endpoint questions (declared auth for gated MCP servers)', () => {
  /** A withMcpAuth-wrapped mount at /mcp — gated by its own code, so it pre-deselects. */
  function addGatedMcpMount(dir2: string): void {
    const routeDir = join(dir2, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => { server.tool('roll_dice', 'd', {}, async () => ({})); });\n` +
        `const authed = withMcpAuth(handler, verifyToken, {});\n` +
        `export { authed as GET };\n`,
      'utf8',
    );
  }

  it('collects manually-entered endpoints + docs URL when the source tree has no OAuth to read', async () => {
    writeBareApp(dir);
    addGatedMcpMount(dir);

    const prompter = new ScriptedPrompter({
      text: [
        'https://acme.com',
        'https://auth.acme.com/authorize',
        'https://auth.acme.com/token',
        'https://acme.com/docs/access',
      ],
      multiSelect: [[], []],
      // No OAuth evidence → the default is api_key; choosing OAuth is what asks the endpoints.
      select: ['oauth2'],
      confirm: [false],
    });

    const code = await runInit([], { ...io(), prompter });

    expect(code).toBe(0);
    const source = readFileSync(join(dir, 'ax.config.ts'), 'utf8');
    expect(source).toContain('identifier: "urn:air:acme.com:mcp-server"');
    expect(source).toContain('authorizationEndpoint: "https://auth.acme.com/authorize"');
    expect(source).toContain('tokenEndpoint: "https://auth.acme.com/token"');
    expect(source).toContain('docsUrl: "https://acme.com/docs/access"');
    // Round-trip: the written config passes the real loader/schema gate and carries the auth.
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({
      status: 'oauth2',
      oauth: {
        authorizationEndpoint: 'https://auth.acme.com/authorize',
        tokenEndpoint: 'https://auth.acme.com/token',
      },
      docsUrl: 'https://acme.com/docs/access',
    });
  });

  it('never asks endpoint questions when an authorization server is declared (runtime-discoverable)', async () => {
    writeBareApp(dir);
    addGatedMcpMount(dir);
    const metaDir = join(dir, 'app', '.well-known', 'oauth-protected-resource');
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(
      join(metaDir, 'route.ts'),
      "import { protectedResourceHandler } from 'mcp-handler';\n" +
        "const handler = protectedResourceHandler({ authServerUrls: ['https://auth.acme.com'] });\n" +
        'export { handler as GET };\n',
      'utf8',
    );

    const textQuestions: string[] = [];
    const prompter = new (class extends ScriptedPrompter {
      override async text(question: string, defaultValue?: string): Promise<string> {
        textQuestions.push(question);
        return super.text(question, defaultValue);
      }
    })({
      text: ['https://acme.com', 'https://acme.com/docs/access'],
      multiSelect: [[], []],
      confirm: [false],
    });

    expect(await runInit([], { ...io(), prompter })).toBe(0);
    // siteUrl and the docs URL — the endpoint questions never ran.
    expect(textQuestions.some((q) => q.includes('endpoint'))).toBe(false);
    expect(
      stdout.some(
        (l) =>
          l.includes('Detected OAuth authorization server') &&
          l.includes('discover its endpoints from the metadata chain'),
      ),
    ).toBe(true);
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({
      status: 'oauth2',
      docsUrl: 'https://acme.com/docs/access',
    });
  });

  it('adopts the endpoints a committed RFC 8414 metadata document already declares (never asked)', async () => {
    writeBareApp(dir);
    addGatedMcpMount(dir);
    const wellKnown = join(dir, 'public', '.well-known');
    mkdirSync(wellKnown, { recursive: true });
    writeFileSync(
      join(wellKnown, 'oauth-authorization-server'),
      JSON.stringify({
        issuer: 'https://acme.com',
        authorization_endpoint: 'https://acme.com/oauth/authorize',
        token_endpoint: 'https://acme.com/oauth/token',
      }),
      'utf8',
    );

    // Only the siteUrl is scripted: the endpoints come from the committed document, not questions.
    const prompter = new ScriptedPrompter({
      text: ['https://acme.com'],
      multiSelect: [[], []],
      confirm: [false],
    });

    const code = await runInit([], { ...io(), prompter });

    expect(code).toBe(0);
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({
      status: 'oauth2',
      oauth: {
        authorizationEndpoint: 'https://acme.com/oauth/authorize',
        tokenEndpoint: 'https://acme.com/oauth/token',
      },
    });
    // The adoption names its source, so the config value is traceable, not magic.
    expect(stdout.some((l) => l.includes('Using the OAuth endpoints your public'))).toBe(true);
    expect(stdout.some((l) => l.includes('will declare auth for /mcp'))).toBe(true);
  });

  it('a docs URL alone keeps the honest "unknown" status; an Enter-through declares api_key', async () => {
    writeBareApp(dir);
    addGatedMcpMount(dir);

    const prompter = new ScriptedPrompter({
      text: ['https://acme.com', '', '', 'https://acme.com/docs/access'],
      multiSelect: [[], []],
      // No OAuth evidence in this fixture, so the scheme default is "skip" — choose OAuth actively.
      select: ['oauth2'],
      confirm: [false],
    });
    expect(await runInit([], { ...io(), prompter })).toBe(0);
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({
      status: 'unknown',
      docsUrl: 'https://acme.com/docs/access',
    });

    // Fresh project, pure Enter-through: with no OAuth evidence the scheme defaults to api_key —
    // the declaration nearly every gated surface can truthfully make — so accepting every default
    // declares it (docs URL skipped). Choosing "skip" is the explicit way to write nothing.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeBareApp(dir);
    addGatedMcpMount(dir);
    stdout = [];
    const enterThrough = new ScriptedPrompter({
      text: ['https://acme.com'],
      multiSelect: [[], []],
      confirm: [false],
    });
    expect(await runInit([], { ...io(), prompter: enterThrough })).toBe(0);
    const { config: rerun } = await loadAxConfig(dir);
    expect(rerun.entries[0]?.auth).toEqual({ status: 'api_key' });
  });

  it('re-prompts on an invalid endpoint URL and skips after repeated bad input', async () => {
    writeBareApp(dir);
    addGatedMcpMount(dir);

    const prompter = new ScriptedPrompter({
      text: [
        'https://acme.com',
        'javascript:alert(1)', // authorization endpoint: three bad tries → skipped
        'not-a-url',
        '/relative',
        'https://auth.acme.com/token', // token endpoint: valid on the first try
        '', // docs: skipped
      ],
      multiSelect: [[], []],
      select: ['oauth2'],
      confirm: [false],
    });
    expect(await runInit([], { ...io(), prompter })).toBe(0);

    expect(stdout.filter((l) => l.includes('is not an absolute http(s) URL'))).toHaveLength(3);
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({
      status: 'oauth2',
      oauth: { tokenEndpoint: 'https://auth.acme.com/token' },
    });
  });

  it('asks nothing when no MCP server is gated', async () => {
    writeBareApp(dir);
    addMcpMount(dir); // plain mount, pre-selected public
    let textQuestions = 0;
    const prompter: Prompter = {
      text: async (_q, d) => {
        textQuestions++;
        return d ?? 'https://acme.com';
      },
      confirm: async () => false,
      multiSelect: async (_q, rows) =>
        rows.filter(isMultiSelectChoice).map((choice) => choice.value),
      select: async () => undefined,
    };
    expect(await runInit([], { ...io(), prompter })).toBe(0);
    // Only the siteUrl question was asked.
    expect(textQuestions).toBe(1);
    expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).not.toContain('entries:');
  });
});

describe('auth-scheme question (api_key and skip branches)', () => {
  function addGatedMount(dir2: string): void {
    const routeDir = join(dir2, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => {});\n` +
        `const authed = withMcpAuth(handler, verifyToken, {});\n` +
        `export { authed as GET };\n`,
      'utf8',
    );
  }

  it('choosing API key declares status "api_key" (with the docs URL) and skips the OAuth questions', async () => {
    writeBareApp(dir);
    addGatedMount(dir);

    const textQuestions: string[] = [];
    const prompter = new (class extends ScriptedPrompter {
      override async text(question: string, defaultValue?: string): Promise<string> {
        textQuestions.push(question);
        return super.text(question, defaultValue);
      }
    })({
      text: ['https://acme.com', 'https://acme.com/docs/api-keys'],
      multiSelect: [[], []],
      select: ['api_key'],
      confirm: [false],
    });

    expect(await runInit([], { ...io(), prompter })).toBe(0);
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({
      status: 'api_key',
      docsUrl: 'https://acme.com/docs/api-keys',
    });
    // The OAuth endpoint questions never ran — only siteUrl and the docs URL were asked.
    expect(textQuestions.some((q) => q.includes('OAuth'))).toBe(false);
    expect(stdout.some((l) => l.includes('API key/bearer + docs link'))).toBe(true);
  });

  it('choosing API key with no docs URL still declares the scheme (an active choice is a declaration)', async () => {
    writeBareApp(dir);
    addGatedMount(dir);

    const prompter = new ScriptedPrompter({
      text: ['https://acme.com', ''],
      multiSelect: [[], []],
      select: ['api_key'],
      confirm: [false],
    });
    expect(await runInit([], { ...io(), prompter })).toBe(0);
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({ status: 'api_key' });
  });

  it('choosing skip asks nothing further and writes no entries', async () => {
    writeBareApp(dir);
    addGatedMount(dir);

    const textQuestions: string[] = [];
    const prompter = new (class extends ScriptedPrompter {
      override async text(question: string, defaultValue?: string): Promise<string> {
        textQuestions.push(question);
        return super.text(question, defaultValue);
      }
    })({
      text: ['https://acme.com'],
      multiSelect: [[], []],
      select: ['skip'],
      confirm: [false],
    });

    expect(await runInit([], { ...io(), prompter })).toBe(0);
    expect(textQuestions).toHaveLength(1); // only siteUrl
    expect(readFileSync(join(dir, 'ax.config.ts'), 'utf8')).not.toContain('entries:');
  });
});

describe('credential-in-URL guard (wizard answers are published verbatim)', () => {
  it('refuses a URL embedding a credential-like query parameter and lets the user retry', async () => {
    writeBareApp(dir);
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => {});\n` +
        `const authed = withMcpAuth(handler, verifyToken, {});\n` +
        `export { authed as GET };\n`,
      'utf8',
    );

    const prompter = new ScriptedPrompter({
      text: [
        'https://acme.com',
        'https://acme.com/docs?api_key=sk-live-123', // refused — embeds a credential
        'https://acme.com/docs/api-access', // clean retry accepted
      ],
      multiSelect: [[], []],
      select: ['api_key'],
      confirm: [false],
    });

    expect(await runInit([], { ...io(), prompter })).toBe(0);
    expect(stdout.some((l) => l.includes('credential-like query parameter'))).toBe(true);
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({
      status: 'api_key',
      docsUrl: 'https://acme.com/docs/api-access',
    });
    expect(JSON.stringify(config)).not.toContain('sk-live-123');
  });
});

describe('provider-wired OAuth evidence (Clerk-style runtime metadata)', () => {
  it('defaults to OAuth, prints the wiring context, and a bare Enter-through declares oauth2', async () => {
    writeBareApp(dir);
    const mountDir = join(dir, 'app', '[transport]');
    mkdirSync(mountDir, { recursive: true });
    writeFileSync(
      join(mountDir, 'route.ts'),
      `import { createMcpHandler, withMcpAuth } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => {});\n` +
        `const authed = withMcpAuth(handler, verifyToken, { resourceMetadataPath: '/.well-known/oauth-protected-resource' });\n` +
        `export { authed as GET };\n`,
      'utf8',
    );
    const metaDir = join(dir, 'app', '.well-known', 'oauth-protected-resource');
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(
      join(metaDir, 'route.ts'),
      "import { protectedResourceHandlerClerk } from '@clerk/mcp-tools/next';\n" +
        'const handler = protectedResourceHandlerClerk();\n' +
        'export { handler as GET };\n',
      'utf8',
    );

    let schemeDefault: string | undefined;
    const prompter = new (class extends ScriptedPrompter {
      override async select(question: string, rows: MultiSelectRow[]): Promise<string | undefined> {
        if (question.startsWith('How do agents authenticate')) {
          schemeDefault = rows.filter(isMultiSelectChoice).find((c) => c.selected)?.value;
        }
        return super.select(question, rows);
      }
    })({
      // Only the siteUrl is scripted — everything else is a pure Enter-through on defaults.
      text: ['https://acme.com'],
      multiSelect: [[], []],
      confirm: [false],
    });

    expect(await runInit([], { ...io(), prompter })).toBe(0);
    expect(schemeDefault).toBe('oauth2');
    expect(stdout.some((l) => l.includes('protected-resource route'))).toBe(true);
    // Endpoints skipped, docs skipped — but the wiring backs a bare oauth2 declaration.
    const { config } = await loadAxConfig(dir);
    expect(config.entries[0]?.auth).toEqual({ status: 'oauth2' });
    expect(stdout.some((l) => l.includes('agent-discoverable at runtime'))).toBe(true);
  });
});
