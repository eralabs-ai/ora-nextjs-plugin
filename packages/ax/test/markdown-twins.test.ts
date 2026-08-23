import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultIsGated } from '../src/gating.js';
import { GENERATED_BY, isGeneratedMarkdown } from '../src/markdown-artifact.js';
import {
  applyMarkdownTwinPlan,
  planMarkdownTwins,
  twinPathnameForRoute,
} from '../src/markdown-twins.js';
import { buildRouterModel } from '../src/router-model.js';

let dir: string;
const warnings: string[] = [];
const recommendations: string[] = [];
const NOW = new Date('2026-08-19T00:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-twins-'));
  warnings.length = 0;
  recommendations.length = 0;
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

/** A prerendered-HTML body with a <main> that clears every Tier-2 guard. */
function html(title: string): string {
  return `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${FILLER}</p></main></body></html>`;
}

function plan(overrides: Record<string, unknown> = {}) {
  return planMarkdownTwins({
    cwd: dir,
    router: buildRouterModel(dir),
    isGated: defaultIsGated,
    basePath: '',
    siteUrl: 'https://example.com',
    enabled: true,
    warn: (m) => warnings.push(m),
    recommend: (m) => recommendations.push(m),
    now: NOW,
    ...overrides,
  });
}

describe('twinPathnameForRoute', () => {
  it('maps the root to /index.md and any other route to <route>.md', () => {
    expect(twinPathnameForRoute('/')).toBe('/index.md');
    expect(twinPathnameForRoute('/docs/getting-started')).toBe('/docs/getting-started.md');
  });
});

describe('planMarkdownTwins — Tier 2 (prerendered HTML)', () => {
  it('plans a twin per prerendered static route, with frontmatter and canonical URL', async () => {
    write('app/page.tsx', 'export default () => null;');
    write('app/docs/page.tsx', 'export default () => null;');
    write('.next/server/app/index.html', html('Home'));
    write('.next/server/app/docs.html', html('Docs'));

    const result = await plan();
    expect(result.writes.map((t) => t.route).sort()).toEqual(['/', '/docs']);
    const docs = result.writes.find((t) => t.route === '/docs');
    expect(docs).toMatchObject({ tier: 2, source: 'prerender', servedPath: '/docs.md' });
    expect(docs?.content).toContain('title: "Docs"');
    expect(docs?.content).toContain('canonical_url: https://example.com/docs');
    expect(docs?.content).toContain(`generated-by: "${GENERATED_BY}"`);
    expect(docs?.content).toContain('last_updated: 2026-08-19T00:00:00.000Z');
    expect(docs?.content).toContain('# Docs');
  });

  it('resolves route groups in the build output back to their URL', async () => {
    write('app/(marketing)/about/page.tsx', 'export default () => null;');
    write('.next/server/app/(marketing)/about.html', html('About'));

    const result = await plan();
    expect(result.writes.map((t) => t.route)).toEqual(['/about']);
  });

  it('skips a non-prerendered route with the not-prerendered reason (Tier 3 refusal)', async () => {
    write('app/dashboard/page.tsx', 'export default () => null;');
    // No .next output at all — nothing was prerendered.
    const result = await plan();
    expect(result.writes).toEqual([]);
    expect(result.skips).toMatchObject([{ route: '/dashboard', reason: 'not-prerendered' }]);
    expect(result.skips[0]?.detail).toContain('prerender');
  });

  it('never derives a twin from a gated route, even when its HTML exists', async () => {
    write('app/private/page.tsx', 'export default () => null;');
    write('.next/server/app/private.html', html('Login'));

    const result = await plan({
      isGated: ({ path }: { path: string }) => path === '/private',
    });
    expect(result.writes).toEqual([]);
    expect(result.skips).toMatchObject([{ route: '/private', reason: 'gated' }]);
  });

  it('skips a JS-shell page with the too-little-text reason', async () => {
    write('app/shell/page.tsx', 'export default () => null;');
    write(
      '.next/server/app/shell.html',
      '<html><body><main><div id="root"></div></main></body></html>',
    );
    const result = await plan();
    expect(result.skips).toMatchObject([{ route: '/shell', reason: 'too-little-text' }]);
  });

  it('counts dynamic page files and recommends rather than guessing their URLs', async () => {
    write('app/blog/[slug]/page.tsx', 'export default () => null;');
    const result = await plan();
    expect(result.dynamicRouteCount).toBe(1);
    expect(recommendations.some((r) => r.includes('dynamic URL'))).toBe(true);
  });
});

describe('planMarkdownTwins — Tier 1 (MDX sources)', () => {
  const PROSE = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} of the guide.`).join('\n\n');

  it('derives a twin from page.mdx when pageExtensions routes it — even with no build output', async () => {
    write('app/guide/page.mdx', `# The Guide\n\n${PROSE}\n`);
    const result = await plan({ pageExtensions: ['ts', 'tsx', 'md', 'mdx'] });
    expect(result.writes).toMatchObject([
      { route: '/guide', tier: 1, source: 'mdx', servedPath: '/guide.md' },
    ]);
    expect(result.writes[0]?.content).toContain('title: "The Guide"');
  });

  it('ignores page.mdx when pageExtensions does not route it (Next.js would not serve it)', async () => {
    write('app/guide/page.mdx', `# The Guide\n\n${PROSE}\n`);
    const result = await plan(); // no pageExtensions
    expect(result.writes).toEqual([]);
    expect(result.skips).toEqual([]);
  });

  it('refuses a component-heavy MDX page with mostly-jsx and recommends instead', async () => {
    write('app/widgets/page.mdx', "import A from 'a'\n\n<A>\n  <b>x</b>\n</A>\n\nOne line.\n");
    const result = await plan({ pageExtensions: ['mdx'] });
    expect(result.skips).toMatchObject([{ route: '/widgets', reason: 'mostly-jsx' }]);
    expect(recommendations.some((r) => r.includes('mostly imports/JSX'))).toBe(true);
  });
});

describe('planMarkdownTwins — user-owned sources and regeneration', () => {
  it('records a marker-less public/<route>.md as user-owned and never plans over it', async () => {
    write('app/docs/page.tsx', 'export default () => null;');
    write('.next/server/app/docs.html', html('Docs'));
    write('public/docs.md', '# My hand-written docs\n');

    const result = await plan();
    expect(result.writes).toEqual([]);
    expect(result.userOwned).toMatchObject([
      { route: '/docs', sourcePath: join('public', 'docs.md') },
    ]);
    expect(result.servedPaths).toEqual(['/docs.md']);
  });

  it('records an app/<route>.md/route.* markdown handler as the user-owned twin', async () => {
    write('app/docs/page.tsx', 'export default () => null;');
    write('.next/server/app/docs.html', html('Docs'));
    write('app/docs.md/route.ts', 'export function GET() { return new Response("# md"); }');

    const result = await plan();
    expect(result.writes).toEqual([]);
    expect(result.userOwned).toMatchObject([
      { route: '/docs', sourcePath: join('app', 'docs.md', 'route.ts') },
    ]);
  });

  it('regenerates over a previously generated twin and sweeps stale ones', async () => {
    write('app/docs/page.tsx', 'export default () => null;');
    write('.next/server/app/docs.html', html('Docs'));
    // A previous run's outputs: one for a still-live route, one for a removed route.
    write('public/docs.md', `---\ntitle: "Old"\ngenerated-by: "${GENERATED_BY}"\n---\n\nold\n`);
    write('public/gone.md', `---\ntitle: "Gone"\ngenerated-by: "${GENERATED_BY}"\n---\n\ngone\n`);

    const result = await plan();
    expect(result.writes.map((t) => t.route)).toEqual(['/docs']);
    expect(result.hasExistingGenerated).toBe(true);
    expect(result.stalePaths).toEqual([join(dir, 'public', 'gone.md')]);
  });

  it('a disabled plan is empty and shape-stable', async () => {
    write('app/page.tsx', 'export default () => null;');
    const result = await plan({ enabled: false });
    expect(result).toMatchObject({ enabled: false, writes: [], skips: [], servedPaths: [] });
  });
});

describe('applyMarkdownTwinPlan', () => {
  it('writes planned twins (as generated markdown) and deletes stale ones', async () => {
    write('app/docs/page.tsx', 'export default () => null;');
    write('.next/server/app/docs.html', html('Docs'));
    write('public/gone.md', `---\ntitle: "Gone"\ngenerated-by: "${GENERATED_BY}"\n---\n\ngone\n`);

    const result = applyMarkdownTwinPlan(dir, await plan(), (m) => warnings.push(m));
    expect(result.written.map((t) => t.route)).toEqual(['/docs']);
    expect(result.deleted).toEqual([join('public', 'gone.md')]);
    const onDisk = readFileSync(join(dir, 'public', 'docs.md'), 'utf8');
    expect(isGeneratedMarkdown(onDisk)).toBe(true);
    expect(existsSync(join(dir, 'public', 'gone.md'))).toBe(false);
  });
});

describe('planMarkdownTwins — metadata rung (content-less pages with page-owned metadata)', () => {
  /** A prerendered shell: real head metadata, an empty <main>. */
  function shellHtml(title: string, description: string): string {
    return (
      `<html><head><title>${title}</title><meta name="description" content="${description}"/>` +
      `</head><body><main><div id="app"></div></main></body></html>`
    );
  }
  const SERVER_SHELL_PAGE =
    "import { Client } from './client';\n" +
    "export const metadata = { title: 'Results', description: 'Search results, live-fetched.' };\n" +
    'export default function Page() {\n  return (\n    <main>\n      <Client />\n    </main>\n  );\n}\n';

  it('derives a minimal, honest twin from a page-owned head when the page has no content', async () => {
    write('app/results/page.tsx', SERVER_SHELL_PAGE);
    write('.next/server/app/results.html', shellHtml('Results', 'Search results, live-fetched.'));

    const result = await plan();
    expect(result.skips).toEqual([]);
    expect(result.writes).toMatchObject([
      { route: '/results', tier: 2, source: 'metadata', servedPath: '/results.md' },
    ]);
    const content = result.writes[0]?.content ?? '';
    expect(content).toContain('title: "Results"');
    expect(content).toContain('# Results');
    expect(content).toContain('Search results, live-fetched.');
    expect(content).toContain('its content loads in the browser');
    // The wayfinding pointer: an agent hitting a minimal twin is sent to the catalog, not a dead end.
    expect(content).toContain(
      '[/.well-known/ai-catalog.json](https://example.com/.well-known/ai-catalog.json)',
    );
    expect(recommendations.some((r) => r.includes('derived from page metadata'))).toBe(true);
  });

  it('refuses when the page does not declare its own metadata (inherited head)', async () => {
    write('app/results/page.tsx', 'export default () => null;');
    write('.next/server/app/results.html', shellHtml('Site', 'Site-wide blurb.'));

    const result = await plan();
    expect(result.writes).toEqual([]);
    expect(result.skips).toMatchObject([{ route: '/results', reason: 'too-little-text' }]);
    // The skip detail carries the fix: per-page metadata from a server page.tsx.
    expect(result.skips[0]?.detail).toContain('metadata');
  });

  it('refuses when the head values are shared with another route (inherited in practice)', async () => {
    // Both pages *declare* metadata but resolve to identical heads — shared constants. N twins
    // with the same body would each claim to describe a specific page, so both are refused.
    write('app/a/page.tsx', SERVER_SHELL_PAGE);
    write('app/b/page.tsx', SERVER_SHELL_PAGE);
    write('.next/server/app/a.html', shellHtml('Same', 'Same blurb.'));
    write('.next/server/app/b.html', shellHtml('Same', 'Same blurb.'));

    const result = await plan();
    expect(result.writes).toEqual([]);
    expect(result.skips.map((s) => s.route).sort()).toEqual(['/a', '/b']);
  });

  it('a metadata mention in a comment never counts as ownership', async () => {
    write(
      'app/results/page.tsx',
      '// TODO: export const metadata = { title: "..." } later\nexport default () => null;',
    );
    write('.next/server/app/results.html', shellHtml('Results', 'Own-looking head.'));
    const result = await plan();
    expect(result.writes).toEqual([]);
    expect(result.skips).toMatchObject([{ route: '/results', reason: 'too-little-text' }]);
  });
});
