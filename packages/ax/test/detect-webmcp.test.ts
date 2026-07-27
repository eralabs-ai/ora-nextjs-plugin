import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
