import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectWebMcp } from '../src/detect-webmcp.js';

let dir: string;
let warnings: string[];
let recommendations: string[];

const warn = (message: string): void => {
  warnings.push(message);
};
const recommend = (message: string): void => {
  recommendations.push(message);
};

const SITE_URL = 'https://example.com';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-detect-webmcp-'));
  warnings = [];
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relPath: string, contents: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

function run(options: { siteUrl?: string } = {}) {
  return detectWebMcp({
    cwd: dir,
    siteUrl: 'siteUrl' in options ? options.siteUrl : SITE_URL,
    basePath: '',
    warn,
    recommend,
  });
}

const DECLARATIVE_PAGE = `export default function Page() {
  return (
    <form toolname="subscribe_newsletter" tooldescription="Subscribe an email." action="/api/subscribe">
      <input name="email" type="email" />
    </form>
  );
}`;

const IMPERATIVE_CLIENT = `'use client';
export function Tools() {
  if (typeof document === 'undefined' || !('modelContext' in document)) return null;
  document.modelContext.registerTool({
    name: 'add_to_cart',
    description: 'Add a product to the cart.',
    async execute() { return { content: [] }; },
  });
  return null;
}`;

describe('detectWebMcp', () => {
  it('detects nothing in an empty project and stays quiet', () => {
    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.toolNames).toEqual([]);
    expect(warnings).toEqual([]);
    expect(recommendations).toEqual([]);
  });

  it('emits a text/html entry for a declarative form on the root page', () => {
    write(join('app', 'page.tsx'), DECLARATIVE_PAGE);

    const result = run();
    expect(result.toolNames).toEqual(['subscribe_newsletter']);
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry?.identifier).toBe('urn:air:example.com:webmcp');
    expect(entry?.type).toBe('text/html');
    expect(entry?.url).toBe('https://example.com/');
    expect(entry?.capabilities).toEqual(['subscribe_newsletter']);
  });

  it('resolves nested page pathnames and skips route groups', () => {
    write(join('app', '(marketing)', 'shop', 'page.tsx'), DECLARATIVE_PAGE);

    const result = run();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.identifier).toBe('urn:air:example.com:webmcp:shop');
    expect(result.entries[0]?.url).toBe('https://example.com/shop');
  });

  it('respects basePath when building the entry URL', () => {
    write(join('app', 'shop', 'page.tsx'), DECLARATIVE_PAGE);

    const result = detectWebMcp({
      cwd: dir,
      siteUrl: SITE_URL,
      basePath: '/store',
      warn,
      recommend,
    });
    expect(result.entries[0]?.url).toBe('https://example.com/store/shop');
  });

  it('never emits an entry for a dynamic-segment page (ambiguous URL)', () => {
    write(join('app', 'products', '[id]', 'page.tsx'), DECLARATIVE_PAGE);

    const result = run();
    expect(result.entries).toEqual([]);
    // The tool itself is still detected and counted.
    expect(result.toolNames).toEqual(['subscribe_newsletter']);
  });

  it('skips entries (with a warning) when no site URL is known', () => {
    write(join('app', 'page.tsx'), DECLARATIVE_PAGE);

    const result = run({ siteUrl: undefined });
    expect(result.entries).toEqual([]);
    expect(warnings.join('\n')).toContain('no site URL is known');
  });

  it('recommends tooldescription when a toolname form lacks one', () => {
    write(
      join('app', 'page.tsx'),
      `export default function Page() { return <form toolname="lonely_tool" action="/x" />; }`,
    );

    run();
    expect(recommendations.join('\n')).toContain('tooldescription');
  });

  it('detects imperative document.modelContext tools in a client component (no entry)', () => {
    write(join('components', 'tools.tsx'), IMPERATIVE_CLIENT);

    const result = run();
    expect(result.toolNames).toEqual(['add_to_cart']);
    expect(result.entries).toEqual([]);
    expect(warnings).toEqual([]);
    // Imperative tools are invisible to HTML scanners — the recommendation says so.
    expect(recommendations.join('\n')).toContain('invisible in server-rendered HTML');
  });

  it('warns that navigator.modelContext is the deprecated entry point', () => {
    write(join('components', 'tools.tsx'), IMPERATIVE_CLIENT.replaceAll('document', 'navigator'));

    const result = run();
    expect(result.toolNames).toEqual(['add_to_cart']);
    expect(warnings.join('\n')).toContain('document.modelContext');
    expect(warnings.join('\n')).toContain('deprecated');
  });

  it('warns on registration in a server component and does not count its tools', () => {
    write(join('app', 'server-tools.tsx'), IMPERATIVE_CLIENT.replace(`'use client';\n`, ''));

    const result = run();
    expect(result.toolNames).toEqual([]);
    expect(warnings.join('\n')).toContain("'use client'");
  });

  it('ignores a <form toolname> mention inside a string literal (prose, not markup)', () => {
    write(
      join('app', 'layout.tsx'),
      `export const metadata = { description: 'Declare tools with <form toolname="fake_tool">.' };`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.toolNames).toEqual([]);
  });

  it('ignores a user-defined function named registerTool (no modelContext receiver)', () => {
    write(
      join('app', 'decoy.ts'),
      `function registerTool(tool: { name: string }) {}\nregisterTool({ name: 'decoy' });`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.toolNames).toEqual([]);
  });

  it('detects the useWebMCP hook only when its package import is present too', () => {
    write(
      join('components', 'hook-tools.tsx'),
      `'use client';
import { useWebMCP } from '@mcp-b/react-webmcp';
export function HookTools() {
  useWebMCP({ name: 'search_docs', description: 'Search the docs.', handler: async () => ({}) });
  return null;
}`,
    );
    write(
      join('components', 'fake-hook.tsx'),
      `'use client';
function useWebMCP(input: unknown) {}
export function FakeHook() { useWebMCP({ name: 'not_detected' }); return null; }`,
    );

    const result = run();
    expect(result.toolNames).toEqual(['search_docs']);
  });

  it('detects provideContext batch registration', () => {
    write(
      join('components', 'batch.tsx'),
      `'use client';
export function Batch() {
  document.modelContext.provideContext({
    tools: [
      { name: 'tool_one', async execute() { return { content: [] }; } },
      { name: 'tool_two', async execute() { return { content: [] }; } },
    ],
  });
  return null;
}`,
    );

    const result = run();
    expect(result.toolNames).toEqual(['tool_one', 'tool_two']);
  });

  it('recommends declarative attributes when forms exist but no WebMCP does', () => {
    write(
      join('app', 'contact', 'page.tsx'),
      `export default function Page() { return <form action="/api/contact"><input name="q" /></form>; }`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(recommendations.join('\n')).toContain('latent');
    expect(recommendations.join('\n')).toContain('toolname');
  });

  it('flags WebMCP dependencies that are never used', () => {
    write(
      'package.json',
      JSON.stringify({ name: 'x', dependencies: { '@mcp-b/global': '^1.0.0' } }),
    );

    run();
    expect(recommendations.join('\n')).toContain('@mcp-b/global');
    expect(recommendations.join('\n')).toContain('no WebMCP tool registration was detected');
  });

  it('never scans node_modules or public', () => {
    write(
      join('node_modules', 'pkg', 'index.js'),
      `document.modelContext.registerTool({ name: 'from_dep' });`,
    );
    write(join('public', 'bundle.js'), `document.modelContext.registerTool({ name: 'bundled' });`);

    const result = run();
    expect(result.sites).toEqual([]);
  });

  it('never throws — a scan is best-effort', () => {
    expect(() => run()).not.toThrow();
  });
});

// Regression suite for a verified class of false positives: text that *mentions* a WebMCP
// registration — a comment, a docs template literal, a metadata string, rendered JSX prose — used to
// reach the emitted catalog as a phantom tool or a spurious "add 'use client'" warning.
describe('detectWebMcp mention-vs-code precision', () => {
  it('ignores a <form toolname> inside a multi-line template literal', () => {
    write(
      join('app', 'page.tsx'),
      `const SNIPPET = \`
<form toolname="ghost_tool" tooldescription="Not real markup.">
  <input name="email" />
</form>
\`;
export default function Page() {
  return <pre>{SNIPPET}</pre>;
}`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.toolNames).toEqual([]);
  });

  it('ignores a registerTool call that only appears in a // comment', () => {
    write(
      join('components', 'notes.tsx'),
      `'use client';
export function Notes() {
  // document.modelContext.registerTool({ name: 'ghost_tool' });
  return null;
}`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.toolNames).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('ignores a registerTool call that only appears in a /* */ comment', () => {
    write(
      join('components', 'notes.tsx'),
      `export function Notes() {
  /**
   * Register with:
   *   document.modelContext.registerTool({ name: 'ghost_tool' });
   */
  return null;
}`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.toolNames).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('ignores an empty-parens registerTool mention in rendered JSX prose', () => {
    write(
      join('app', 'page.tsx'),
      `export default function Home() {
  return (
    <main>
      <p>Registers an in-page tool via navigator.modelContext.registerTool().</p>
    </main>
  );
}`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.toolNames).toEqual([]);
    // Notably: no "add 'use client'" warning and no navigator deprecation warning.
    expect(warnings).toEqual([]);
  });

  it('ignores a registerTool mention inside a metadata string literal', () => {
    write(
      join('app', 'layout.tsx'),
      `export const metadata = {
  title: 'Fixture',
  description: 'Registers an in-page WebMCP tool via navigator.modelContext.registerTool().',
};`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.toolNames).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('ignores a registration written out, arguments and all, inside a string literal', () => {
    write(
      join('app', 'docs.ts'),
      `export const HOWTO =\n  "Call document.modelContext.registerTool({ name: 'ghost_tool' }) in a client component.";`,
    );

    const result = run();
    expect(result.sites).toEqual([]);
    expect(result.toolNames).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('still detects a real multi-line registerTool in a client component', () => {
    write(join('components', 'tools.tsx'), IMPERATIVE_CLIENT);

    const result = run();
    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]?.receiver).toBe('document');
    expect(result.toolNames).toEqual(['add_to_cart']);
    expect(warnings).toEqual([]);
  });

  it('still detects a window.modelContext receiver', () => {
    write(
      join('components', 'tools.tsx'),
      `'use client';
export function Tools() {
  window.modelContext.registerTool({ name: 'window_tool', async execute() { return {}; } });
  return null;
}`,
    );

    const result = run();
    expect(result.sites[0]?.receiver).toBe('window');
    expect(result.toolNames).toEqual(['window_tool']);
  });

  it('still detects a declarative form in real JSX alongside a commented-out one', () => {
    write(
      join('app', 'page.tsx'),
      `export default function Page() {
  return (
    <main>
      {/* <form toolname="ghost_tool" tooldescription="Commented out." /> */}
      <form toolname="subscribe_newsletter" tooldescription="Subscribe an email." action="/api/s">
        <input name="email" type="email" />
      </form>
    </main>
  );
}`,
    );

    const result = run();
    expect(result.toolNames).toEqual(['subscribe_newsletter']);
    expect(result.entries[0]?.capabilities).toEqual(['subscribe_newsletter']);
  });

  it('scopes the tooldescription recommendation per form, not per file', () => {
    write(
      join('app', 'page.tsx'),
      `export default function Page() {
  return (
    <main>
      <form toolname="described_tool" tooldescription="Has one." action="/a" />
      <form toolname="undescribed_tool" action="/b" />
    </main>
  );
}`,
    );

    run();
    const message = recommendations.find((r) => r.includes('tooldescription attribute'));
    // A single compliant form used to silence the recommendation for every other form in the file.
    expect(message).toContain('undescribed_tool');
    expect(message).not.toContain('described_tool,');
  });
});

// The webmcp-imperative fixture is the end-to-end shape of the bug: its layout.tsx mentions the API
// in a metadata string and its page.tsx renders it as visible prose, which produced four spurious
// warnings while the one real registration lives in a separate client component.
describe('detectWebMcp against the webmcp-imperative fixture', () => {
  it('warns about nothing while still detecting the real registration', () => {
    const fixture = fileURLToPath(new URL('../../../fixtures/webmcp-imperative/', import.meta.url));
    const result = detectWebMcp({
      cwd: fixture,
      siteUrl: SITE_URL,
      basePath: '',
      warn,
      recommend,
    });

    expect(warnings).toEqual([]);
    expect(result.toolNames).toEqual(['add_to_cart']);
    expect(result.entries).toEqual([]);
    expect(result.sites.map((site) => site.source)).toEqual([join('app', 'register-tools.tsx')]);
  });
});
