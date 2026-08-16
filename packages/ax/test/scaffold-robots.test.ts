import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectRobots } from '../src/detect-robots.js';
import { scaffoldRobots } from '../src/scaffold-robots.js';

let dir: string;
let warnings: string[];
let recommendations: string[];
const warn = (message: string): void => {
  warnings.push(message);
};
const recommend = (message: string): void => {
  recommendations.push(message);
};

/** The options a real build passes: a resolved origin, a detected sitemap, no basePath. */
function options(overrides: Record<string, unknown> = {}) {
  return {
    cwd: dir,
    siteUrl: 'https://example.com',
    basePath: '',
    sitemapFound: true,
    warn,
    ...overrides,
  };
}

function robotsPath(): string {
  return join(dir, 'public', 'robots.txt');
}

function writeExistingRobots(contents: string): void {
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(robotsPath(), contents, 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-scaffold-robots-'));
  warnings = [];
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scaffoldRobots — creating a robots.txt', () => {
  it('writes public/robots.txt with agent Allow rules and both discovery pointers', () => {
    const result = scaffoldRobots(options());

    expect(result).toMatchObject({ action: 'created', path: robotsPath() });
    const contents = readFileSync(robotsPath(), 'utf8');
    expect(contents).toContain('User-agent: GPTBot');
    expect(contents).toContain('User-agent: ClaudeBot');
    expect(contents).toContain('User-agent: Claude-User');
    expect(contents).toContain('User-agent: PerplexityBot');
    expect(contents).toContain('User-agent: Google-Extended');
    expect(contents).toContain('Sitemap: https://example.com/sitemap.xml');
    expect(contents).toContain('Agentmap: https://example.com/.well-known/ai-catalog.json');
  });

  it('names the retrieval/search crawler families the corpus tracks, from the shared source', () => {
    scaffoldRobots(options());

    const contents = readFileSync(robotsPath(), 'utf8');
    // The Allow block is built from the agent-ua corpus, so it covers the retrieval/search families
    // a five-name list missed — search fetchers and the reputable general crawlers alike.
    for (const agent of [
      'OAI-SearchBot',
      'ChatGPT-User',
      'Claude-SearchBot',
      'Meta-ExternalAgent',
      'Meta-ExternalFetcher',
      'Amazonbot',
      'AI2Bot',
      'Diffbot',
    ]) {
      expect(contents).toContain(`User-agent: ${agent}`);
    }
    // Every named crawler is allowed, never disallowed — the scaffold never blocks on the owner's behalf.
    expect(contents).not.toMatch(/^Disallow:/m);
  });

  it('shows how to restrict training-only crawlers but never does it for you', () => {
    scaffoldRobots(options());

    const contents = readFileSync(robotsPath(), 'utf8');
    // Present as an example, and only as an example — an uncommented Disallow would be the plugin
    // making a content-policy decision on the site owner's behalf.
    expect(contents).toContain('# User-agent: CCBot');
    expect(contents).toContain('# User-agent: Bytespider');
    expect(contents).not.toMatch(/^Disallow:/m);
  });

  it('omits the Sitemap: line when no sitemap exists, but still writes Agentmap:', () => {
    scaffoldRobots(options({ sitemapFound: false }));

    const contents = readFileSync(robotsPath(), 'utf8');
    expect(contents).not.toMatch(/^Sitemap:/m);
    expect(contents).toContain('Agentmap: https://example.com/.well-known/ai-catalog.json');
  });

  it('writes neither pointer without a site URL, and says how to get them', () => {
    const result = scaffoldRobots(options({ siteUrl: undefined }));

    expect(result.action).toBe('created');
    const contents = readFileSync(robotsPath(), 'utf8');
    expect(contents).not.toMatch(/^Sitemap:/m);
    expect(contents).not.toMatch(/^Agentmap:/m);
    expect(contents).toContain('siteUrl in ax.config');
  });

  it('respects basePath when building the pointer URLs', () => {
    scaffoldRobots(options({ basePath: '/app' }));

    const contents = readFileSync(robotsPath(), 'utf8');
    expect(contents).toContain('Sitemap: https://example.com/app/sitemap.xml');
    expect(contents).toContain('Agentmap: https://example.com/app/.well-known/ai-catalog.json');
  });

  it('never overwrites the file it wrote — a second run leaves it byte-identical', () => {
    scaffoldRobots(options());
    const afterFirstRun = readFileSync(robotsPath(), 'utf8');

    const second = scaffoldRobots(options({ existingSource: robotsPath() }));

    expect(second.action).toBe('unchanged');
    expect(readFileSync(robotsPath(), 'utf8')).toBe(afterFirstRun);
  });
});

describe('scaffoldRobots — appending to an existing robots.txt', () => {
  it('appends the missing pointers in a marked block, leaving existing lines untouched', () => {
    writeExistingRobots('User-agent: *\nDisallow: /admin\n');

    const result = scaffoldRobots(options({ existingSource: robotsPath() }));

    expect(result.action).toBe('appended');
    expect(result.addedLines).toEqual([
      'Sitemap: https://example.com/sitemap.xml',
      'Agentmap: https://example.com/.well-known/ai-catalog.json',
    ]);
    const contents = readFileSync(robotsPath(), 'utf8');
    expect(contents).toContain('User-agent: *\nDisallow: /admin\n');
    expect(contents).toContain('# Added by @ora-ai/ax');
  });

  it('is idempotent — running twice appends nothing the second time', () => {
    writeExistingRobots('User-agent: *\nAllow: /\n');

    scaffoldRobots(options({ existingSource: robotsPath() }));
    const afterFirstRun = readFileSync(robotsPath(), 'utf8');
    const second = scaffoldRobots(options({ existingSource: robotsPath() }));

    expect(second.action).toBe('unchanged');
    expect(readFileSync(robotsPath(), 'utf8')).toBe(afterFirstRun);
    expect(afterFirstRun.match(/^Agentmap:/gm)).toHaveLength(1);
  });

  it('leaves a hand-written Sitemap: line alone and adds only the missing Agentmap:', () => {
    writeExistingRobots('User-agent: *\nAllow: /\n\nsitemap: https://example.com/custom-map.xml\n');

    const result = scaffoldRobots(options({ existingSource: robotsPath() }));

    // Matched case-insensitively: a directive the developer already declared is declared, however
    // they capitalized it.
    expect(result.addedLines).toEqual([
      'Agentmap: https://example.com/.well-known/ai-catalog.json',
    ]);
    expect(readFileSync(robotsPath(), 'utf8')).toContain('https://example.com/custom-map.xml');
  });

  it('separates the appended block when the file has no trailing newline', () => {
    writeExistingRobots('User-agent: *\nAllow: /');

    scaffoldRobots(options({ existingSource: robotsPath() }));

    const contents = readFileSync(robotsPath(), 'utf8');
    expect(contents).toContain('Allow: /\n\n# Added by @ora-ai/ax');
  });

  it('adds nothing when no site URL resolved, and says why', () => {
    writeExistingRobots('User-agent: *\nAllow: /\n');

    const result = scaffoldRobots(options({ existingSource: robotsPath(), siteUrl: undefined }));

    expect(result.action).toBe('unchanged');
    expect(result.reason).toContain('no site URL resolved');
    expect(readFileSync(robotsPath(), 'utf8')).toBe('User-agent: *\nAllow: /\n');
  });
});

describe('scaffoldRobots — an App Router robots route', () => {
  it('never touches app/robots.ts, and warns that the flag did nothing', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    const routeFile = join(dir, 'app', 'robots.ts');
    writeFileSync(routeFile, 'export default function robots() { return {}; }\n', 'utf8');

    const result = scaffoldRobots(options({ existingSource: routeFile }));

    expect(result).toMatchObject({ action: 'skipped', path: routeFile });
    expect(readFileSync(routeFile, 'utf8')).toBe(
      'export default function robots() { return {}; }\n',
    );
    expect(existsSync(robotsPath())).toBe(false);
    expect(warnings.some((w) => w.includes('never edits a route handler'))).toBe(true);
  });
});

describe('detectRobots — scaffold wiring', () => {
  it('writes nothing when scaffoldRobots is off, and recommends the flag', () => {
    const result = detectRobots({ cwd: dir, recommend });

    expect(result).toEqual({ found: false });
    expect(existsSync(robotsPath())).toBe(false);
    expect(recommendations.join('\n')).toContain('scaffoldRobots: true');
  });

  it('reports a robots.txt it created this run as found, with no "add one" recommendation', () => {
    const result = detectRobots({
      cwd: dir,
      recommend,
      warn,
      scaffold: true,
      siteUrl: 'https://example.com',
      basePath: '',
      sitemapFound: false,
    });

    expect(result.found).toBe(true);
    expect(result.source).toBe(robotsPath());
    expect(result.scaffold?.action).toBe('created');
    expect(recommendations.join('\n')).not.toContain('No robots.txt found');
  });

  it('drops the "reference your sitemap and catalog" advice once it has handled the pointers', () => {
    writeExistingRobots('User-agent: *\nAllow: /\n');

    detectRobots({
      cwd: dir,
      recommend,
      warn,
      scaffold: true,
      siteUrl: 'https://example.com',
      basePath: '',
      sitemapFound: true,
    });

    const joined = recommendations.join('\n');
    expect(joined).toContain('robots.txt detected');
    expect(joined).not.toContain('Agentmap:');
  });
});
