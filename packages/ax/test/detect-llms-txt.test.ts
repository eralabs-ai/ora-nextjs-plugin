import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectLlmsTxt } from '../src/detect-llms-txt.js';

let dir: string;
let warnings: string[];
let recommendations: string[];
const warn = (message: string): void => {
  warnings.push(message);
};
const recommend = (message: string): void => {
  recommendations.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-detect-llms-txt-'));
  warnings = [];
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectLlmsTxt — detection', () => {
  it('references an existing app/llms.txt/route.ts', () => {
    const routeDir = join(dir, 'app', 'llms.txt');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, 'route.ts'), "export const dynamic = 'force-static';\n", 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    expect(result.entry).toMatchObject({
      identifier: 'urn:air:example.com:llms-txt',
      type: 'text/markdown',
      url: 'https://example.com/llms.txt',
    });
    expect(result.scaffoldedPath).toBeUndefined();
  });

  it('references an existing static public/llms.txt', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# hello\n', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    expect(result.entry?.url).toBe('https://example.com/llms.txt');
  });

  it('prefers a route handler over a static file when both exist', () => {
    const routeDir = join(dir, 'app', 'llms.txt');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, 'route.ts'), "export const dynamic = 'force-static';\n", 'utf8');
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# static\n', 'utf8');

    // Both resolve to the same reference URL; this just documents the lookup never throws when
    // both exist.
    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });
    expect(result.entry?.url).toBe('https://example.com/llms.txt');
  });

  it('respects basePath when building the URL', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# hello\n', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '/app',
      warn,
      scaffold: true,
    });
    expect(result.entry?.url).toBe('https://example.com/app/llms.txt');
  });

  it('warns and skips emitting an entry when no siteUrl is known, even if llms.txt exists', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# hello\n', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: undefined,
      basePath: '',
      warn,
      scaffold: true,
    });
    expect(result.entry).toBeUndefined();
    expect(warnings.some((w) => w.includes('no site URL is known'))).toBe(true);
  });
});

describe('detectLlmsTxt — scaffolding', () => {
  it('scaffolds a starter app/llms.txt/route.ts when a tsconfig.json is present', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    expect(result.entry).toBeUndefined(); // this run's build never served the file it just wrote
    const expectedPath = join(dir, 'app', 'llms.txt', 'route.ts');
    expect(result.scaffoldedPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    const scaffolded = readFileSync(expectedPath, 'utf8');
    expect(scaffolded).toContain('export function GET(): Response');
    // The scaffold ships the "When to use" section since that's what tells an agent whether your
    // site is relevant to its task; the developer/skill fills in the actual content.
    expect(scaffolded).toContain('## When to use');
    expect(warnings.some((w) => w.includes('Scaffolded a starter llms.txt'))).toBe(true);
  });

  it('scaffolds a .js starter when there is no tsconfig.json', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    const expectedPath = join(dir, 'app', 'llms.txt', 'route.js');
    expect(result.scaffoldedPath).toBe(expectedPath);
    expect(readFileSync(expectedPath, 'utf8')).toContain('export function GET()');
    expect(readFileSync(expectedPath, 'utf8')).not.toContain(': Response');
  });

  it('does not write when scaffold: false, but recommends adding one (with the JSON-LD pairing)', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      recommend,
      scaffold: false,
    });

    expect(result).toEqual({ found: false });
    expect(existsSync(join(dir, 'app', 'llms.txt'))).toBe(false);
    const message = recommendations.join('\n');
    expect(message).toContain('No llms.txt found');
    // Explains the dependency so an agent doesn't add llms.txt in isolation.
    expect(message).toContain('JSON-LD');
  });

  it('does nothing when there is no app/ directory to scaffold into', () => {
    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });
    expect(result).toEqual({ found: false });
  });

  it('never overwrites an existing route file (idempotent across runs)', () => {
    const routeDir = join(dir, 'app', 'llms.txt');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, 'route.ts'), '# custom content\n', 'utf8');

    detectLlmsTxt({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn, scaffold: true });

    expect(readFileSync(join(routeDir, 'route.ts'), 'utf8')).toBe('# custom content\n');
  });

  it('fills the starter with the app’s real content, not example.com boilerplate', () => {
    mkdirSync(join(dir, 'app', 'pricing'), { recursive: true });
    mkdirSync(join(dir, 'app', 'docs'), { recursive: true });
    mkdirSync(join(dir, 'app', 'blog', '[slug]'), { recursive: true });
    for (const page of [['page.tsx'], ['pricing', 'page.tsx'], ['docs', 'page.tsx']]) {
      writeFileSync(join(dir, 'app', ...page), 'export default function P() {}\n', 'utf8');
    }
    writeFileSync(
      join(dir, 'app', 'blog', '[slug]', 'page.tsx'),
      'export default function P() {}\n',
      'utf8',
    );
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');

    detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
      site: { displayName: 'acme', description: 'Acme sells widgets.' },
      resources: { openApi: true, mcpPathnames: ['/mcp'] },
    });

    const scaffolded = readFileSync(join(dir, 'app', 'llms.txt', 'route.ts'), 'utf8');
    expect(scaffolded).toContain('# acme');
    expect(scaffolded).toContain('> Acme sells widgets.');
    // Real routes, absolute — and never a dynamic segment, whose concrete URL isn't knowable.
    expect(scaffolded).toContain('- [/](https://example.com/)');
    expect(scaffolded).toContain('- [/docs](https://example.com/docs)');
    expect(scaffolded).toContain('- [/pricing](https://example.com/pricing)');
    expect(scaffolded).not.toContain('[slug]');
    // Only the artifacts this build actually has.
    expect(scaffolded).toContain('https://example.com/.well-known/ai-catalog.json');
    expect(scaffolded).toContain('https://example.com/openapi.json');
    expect(scaffolded).toContain('https://example.com/mcp');
    // The invented boilerplate the old template shipped is gone.
    expect(scaffolded).not.toContain('# Your site');
    expect(scaffolded).not.toContain('[Docs](');
    expect(scaffolded).not.toContain('[Pricing](');
  });

  it('lists only the machine-readable artifacts that exist', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
      site: { displayName: 'acme' },
    });

    const scaffolded = readFileSync(join(dir, 'app', 'llms.txt', 'route.js'), 'utf8');
    expect(scaffolded).toContain('AI Catalog');
    expect(scaffolded).not.toContain('OpenAPI');
    expect(scaffolded).not.toContain('MCP server');
  });

  it('marks "When to use" as a TODO and says why a placeholder earns nothing', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
      site: { displayName: 'acme' },
    });

    const scaffolded = readFileSync(join(dir, 'app', 'llms.txt', 'route.js'), 'utf8');
    expect(scaffolded).toContain('## When to use');
    expect(scaffolded).toContain('TODO');
    expect(scaffolded).toContain('placeholder earns no credit');
  });

  it('falls back to served paths, never a guessed origin, when no siteUrl resolved', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'page.tsx'), 'export default function P() {}\n', 'utf8');

    detectLlmsTxt({
      cwd: dir,
      siteUrl: undefined,
      basePath: '',
      warn,
      scaffold: true,
      site: { displayName: 'acme' },
    });

    const scaffolded = readFileSync(join(dir, 'app', 'llms.txt', 'route.js'), 'utf8');
    expect(scaffolded).toContain('- [/](/)');
    expect(scaffolded).toContain('(/.well-known/ai-catalog.json)');
    expect(scaffolded).not.toContain('https://');
  });

  it('escapes derived values that would otherwise break the template literal', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
      site: { displayName: 'acme', description: 'Uses `backticks` and ${interpolation}.' },
    });

    const scaffolded = readFileSync(join(dir, 'app', 'llms.txt', 'route.js'), 'utf8');
    expect(scaffolded).toContain('\\`backticks\\`');
    expect(scaffolded).toContain('\\${interpolation}');
  });

  it('warns instead of throwing when app/llms.txt exists as a plain file, not a directory', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'llms.txt'), 'not a directory', 'utf8');

    expect(() =>
      detectLlmsTxt({
        cwd: dir,
        siteUrl: 'https://example.com',
        basePath: '',
        warn,
        scaffold: true,
      }),
    ).not.toThrow();
    expect(warnings.some((w) => w.includes("couldn't"))).toBe(true);
  });
});

describe('detectLlmsTxt — Pages Router', () => {
  it('scaffolds a static public/llms.txt (not an app route) for a Pages Router app', () => {
    mkdirSync(join(dir, 'pages'), { recursive: true });
    writeFileSync(join(dir, 'pages', 'index.tsx'), 'export default function H() { return null; }\n');
    writeFileSync(join(dir, 'pages', 'about.tsx'), 'export default function A() { return null; }\n');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
      site: { displayName: 'acme' },
    });

    // A Pages Router app can't serve /llms.txt from pages/api at the right URL, so ax writes the
    // static file — served identically by either router — rather than a route handler.
    const staticPath = join(dir, 'public', 'llms.txt');
    expect(result.scaffoldedPath).toBe(staticPath);
    expect(existsSync(join(dir, 'app'))).toBe(false);

    const body = readFileSync(staticPath, 'utf8');
    expect(body).toContain('# acme');
    // Key pages come from the Pages Router route table.
    expect(body).toContain('/about');
  });

  it('references an existing static public/llms.txt on a Pages Router app without scaffolding', () => {
    mkdirSync(join(dir, 'pages'), { recursive: true });
    writeFileSync(join(dir, 'pages', 'index.tsx'), 'export default function H() { return null; }\n');
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'llms.txt'), '# hello\n', 'utf8');

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    expect(result).toMatchObject({ found: true, source: join('public', 'llms.txt') });
    expect(result.scaffoldedPath).toBeUndefined();
  });
});
