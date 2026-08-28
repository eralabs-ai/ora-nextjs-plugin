import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyNotFoundMdPlan,
  buildNotFoundMd,
  detectAgent404,
  NOT_FOUND_MD_PATHNAME,
} from '../src/agent-404.js';
import type { ServingManifestData } from '../src/manifest.js';
import { isGeneratedMarkdown } from '../src/markdown-artifact.js';

let dir: string;
let recommendations: string[];
let warnings: string[];

const recommend = (message: string): void => {
  recommendations.push(message);
};
const warn = (message: string): void => {
  warnings.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-agent-404-'));
  recommendations = [];
  warnings = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relPath: string, contents: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

function run(overrides: Partial<Parameters<typeof detectAgent404>[0]> = {}) {
  return detectAgent404({
    cwd: dir,
    basePath: '',
    notFoundMdPlanned: true,
    recommend,
    ...overrides,
  });
}

const LINK_TAG = '<link rel="alternate" type="text/markdown" href="/404.md" />';

describe('detectAgent404 — no 404 page at all', () => {
  it('does nothing without a router', () => {
    const result = run();
    expect(result).toEqual({ notFoundPresent: false, agentAware: false, pages: [] });
    expect(recommendations).toEqual([]);
  });

  it('recommends creating a standard 404 page carrying the alternate-link tag', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    const result = run();
    expect(result.notFoundPresent).toBe(false);
    const message = recommendations.join('\n');
    expect(message).toContain('No app/not-found.tsx found');
    // The page's design is the user's — the recommendation asks for a standard page + one tag,
    // never a route list or agent-addressed content.
    expect(message).toContain('your own design system');
    expect(message).toContain(LINK_TAG);
    expect(message).not.toContain('scaffold');
  });

  it('recommends the pages/404 convention path for a Pages Router app', () => {
    mkdirSync(join(dir, 'pages'), { recursive: true });

    const result = run();
    expect(result.notFoundPresent).toBe(false);
    expect(recommendations.join('\n')).toContain('No pages/404.tsx found');
  });

  it('says the guide is not written when markdownTwins is off', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });

    run({ notFoundMdPlanned: false });
    expect(recommendations.join('\n')).toContain('markdownTwins');
    expect(recommendations.join('\n')).toContain('disabled');
  });
});

describe('detectAgent404 — pages exist', () => {
  it('recommends the link tag for a page that points agents nowhere', () => {
    write(
      join('app', 'not-found.tsx'),
      'export default function NotFound() { return <h1>404</h1>; }',
    );

    const result = run();
    expect(result).toEqual({
      notFoundPresent: true,
      agentAware: false,
      pages: [{ source: join('app', 'not-found.tsx'), agentAware: false }],
    });
    const message = recommendations.join('\n');
    expect(message).toContain(LINK_TAG);
    expect(message).toContain('ax never edits it');
  });

  it('stays quiet when the page links the wayfinding guide', () => {
    write(
      join('app', 'not-found.tsx'),
      `export default function NotFound() { return <main>${LINK_TAG}<h1>404</h1></main>; }`,
    );

    const result = run();
    expect(result).toMatchObject({ notFoundPresent: true, agentAware: true });
    expect(recommendations).toEqual([]);
  });

  it('accepts hand-built signposts (llms.txt / ai-catalog links) as agent-aware too', () => {
    write(
      join('app', 'not-found.tsx'),
      'export default function NotFound() { return <a href="/llms.txt">llms.txt</a>; }',
    );

    expect(run().agentAware).toBe(true);
    expect(recommendations).toEqual([]);
  });

  it('detects segment-level not-found files, naming only the unlinked ones', () => {
    // Dynamic-route misses (`/docs/[slug]` with a bad slug) render the *nearest* not-found file,
    // bypassing the root one — so a linked root page alone is not agent-aware coverage.
    write(join('app', 'not-found.tsx'), `export default () => ${JSON.stringify(LINK_TAG)};`);
    write(
      join('app', 'docs', 'not-found.jsx'),
      'export default function NotFound() { return null; }',
    );

    const result = run();
    expect(result.agentAware).toBe(false);
    expect(result.pages).toEqual([
      { source: join('app', 'docs', 'not-found.jsx'), agentAware: false },
      { source: join('app', 'not-found.tsx'), agentAware: true },
    ]);
    const message = recommendations.join('\n');
    expect(message).toContain(join('app', 'docs', 'not-found.jsx'));
    expect(message).not.toContain(join('app', 'not-found.tsx'));
  });

  it('detects across both routers at once', () => {
    write(join('app', 'not-found.tsx'), 'export default () => null;');
    write(join('pages', '404.tsx'), 'export default () => null;');

    const result = run();
    expect(result.pages.map((page) => page.source)).toEqual([
      join('app', 'not-found.tsx'),
      join('pages', '404.tsx'),
    ]);
  });

  it('prefixes the recommended link href with basePath', () => {
    write(join('app', 'not-found.tsx'), 'export default () => null;');

    run({ basePath: '/store' });
    expect(recommendations.join('\n')).toContain('href="/store/404.md"');
  });

  it('never throws — a scan is best-effort', () => {
    expect(() => run()).not.toThrow();
  });
});

const manifest: ServingManifestData = {
  basePath: '',
  routes: ['/', '/docs', '/pricing'],
  dynamicRoutePrefixes: ['/blog'],
  markdownTwins: { '/docs': '/docs.md' },
  gatedPaths: [],
  artifacts: {
    aiCatalog: '/.well-known/ai-catalog.json',
    llmsTxt: '/llms.txt',
    authMd: '/auth.md',
  },
};

describe('buildNotFoundMd', () => {
  it('renders frontmatter plus the URL-neutral wayfinding body', () => {
    const plan = buildNotFoundMd({
      manifest,
      siteUrl: 'https://example.com',
      basePath: '',
      siteDisplayName: 'Example',
      now: new Date('2026-08-28T00:00:00.000Z'),
    });

    expect(plan.servedPath).toBe(NOT_FOUND_MD_PATHNAME);
    expect(plan.routeCount).toBe(3);
    expect(isGeneratedMarkdown(plan.content)).toBe(true);
    expect(plan.content).toContain('title: "Page not found — Example"');
    expect(plan.content).toContain('canonical_url: https://example.com/404.md');
    expect(plan.content).toContain('# Page not found');
    expect(plan.content).toContain('[/docs](/docs) — markdown: [/docs.md](/docs.md)');
    expect(plan.content).toContain('[/llms.txt](/llms.txt)');
    expect(plan.content).toContain('[/auth.md](/auth.md)');
  });

  it('serves under basePath and falls back to the served path with no site origin', () => {
    const plan = buildNotFoundMd({
      manifest: { ...manifest, basePath: '/store' },
      siteUrl: undefined,
      basePath: '/store',
      siteDisplayName: 'Example',
    });
    expect(plan.servedPath).toBe('/store/404.md');
    expect(plan.content).toContain('canonical_url: /store/404.md');
  });
});

describe('applyNotFoundMdPlan', () => {
  const plan = () =>
    buildNotFoundMd({
      manifest,
      siteUrl: 'https://example.com',
      basePath: '',
      siteDisplayName: 'Example',
    });

  it('writes public/404.md and removes it when there is no plan', () => {
    const written = applyNotFoundMdPlan(dir, plan(), warn);
    expect(written).toEqual({ written: join('public', '404.md') });
    expect(existsSync(join(dir, 'public', '404.md'))).toBe(true);

    const deleted = applyNotFoundMdPlan(dir, undefined, warn);
    expect(deleted).toEqual({ deleted: join('public', '404.md') });
    expect(existsSync(join(dir, 'public', '404.md'))).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('never overwrites or deletes a user-authored public/404.md', () => {
    write(join('public', '404.md'), '# my own 404 guide\n');

    expect(applyNotFoundMdPlan(dir, plan(), warn)).toEqual({});
    expect(readFileSync(join(dir, 'public', '404.md'), 'utf8')).toBe('# my own 404 guide\n');
    expect(warnings.join('\n')).toContain('not generated by ax');

    expect(applyNotFoundMdPlan(dir, undefined, warn)).toEqual({});
    expect(existsSync(join(dir, 'public', '404.md'))).toBe(true);
  });
});
