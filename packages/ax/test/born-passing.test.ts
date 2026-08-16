import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectLlmsTxt } from '../src/detect-llms-txt.js';
import { scaffoldRobots } from '../src/scaffold-robots.js';

// Born-passing: the black-box audits a deployed site faces are acceptance criteria for what ax
// generates, so "ax ran" implies "the mechanical half of an agent-readiness audit is already green."
// The audits probe served content over HTTP; here the same checks run against the file contents ax
// writes, which are exactly what a server serves at those paths.

let dir: string;
const warnings: string[] = [];
const warn = (message: string): void => {
  warnings.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-born-passing-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  warnings.length = 0;
});

/** Column-0 code-fence markers (``` or ~~~). An odd count means an unclosed fence. */
function fenceMarkerCount(markdown: string): number {
  return (markdown.match(/^(`{3,}|~{3,})/gm) ?? []).length;
}

/** Asserts a served llms.txt body meets every audit criterion, by construction. */
function expectValidLlmsTxt(body: string): void {
  // An H1 (`# `) at column 0 — the title an agent reads first.
  expect(body).toMatch(/^# .+/m);
  // At least one markdown link, so the file leads somewhere.
  expect(body).toMatch(/\[[^\]]+\]\([^)]+\)/);
  // Under Claude Code's 100,000-char truncation ceiling.
  expect(body.length).toBeLessThanOrEqual(100_000);
  // An even number of fence markers — no fence left open to corrupt everything below it.
  expect(fenceMarkerCount(body) % 2).toBe(0);
}

describe('born-passing: scaffolded llms.txt', () => {
  it('a static (Pages Router) scaffold is valid llms.txt as served', () => {
    // A Pages Router app (no app/ dir) scaffolds a static public/llms.txt whose bytes are served
    // verbatim at /llms.txt — the raw markdown an audit reads.
    mkdirSync(join(dir, 'pages'), { recursive: true });
    writeFileSync(join(dir, 'pages', 'index.jsx'), 'export default () => null;\n', 'utf8');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo-app', description: 'A demo app for agents.' }),
      'utf8',
    );

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    const scaffolded = result.scaffoldedPath;
    expect(scaffolded).toBe(join(dir, 'public', 'llms.txt'));
    expectValidLlmsTxt(readFileSync(scaffolded as string, 'utf8'));
  });

  it('an App Router scaffold serves a body that is valid llms.txt', () => {
    // The App Router scaffold wraps the same markdown body in a route handler. The body reaches the
    // client through the template literal, so audit criteria are asserted against that body.
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo-app', description: 'A demo app for agents.' }),
      'utf8',
    );

    const result = detectLlmsTxt({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
      scaffold: true,
    });

    const scaffolded = result.scaffoldedPath;
    expect(scaffolded).toBe(join(dir, 'app', 'llms.txt', 'route.ts'));
    const body = extractRouteBody(readFileSync(scaffolded as string, 'utf8'));
    expectValidLlmsTxt(body);
  });
});

/** Unwraps the markdown body embedded as a template literal in a scaffolded route handler. */
function extractRouteBody(routeSource: string): string {
  const match = routeSource.match(/const body = `([\s\S]*?)`;/);
  if (!match || match[1] === undefined) throw new Error('could not find the route body literal');
  return match[1]
    .replace(/\\\$\{/g, '${')
    .replace(/\\`/g, '`')
    .replace(/\\\\/g, '\\');
}

// ---------------------------------------------------------------------------
// A real robots.txt user-agent block parser, so the assertion below tests the served policy the
// way a crawler resolves it — grouping User-agent lines with the rules that follow, picking the
// most specific matching group, and honoring only uncommented lines — not a naive substring scan.
// ---------------------------------------------------------------------------

interface RobotsGroup {
  agents: string[];
  rules: Array<{ field: 'allow' | 'disallow'; path: string }>;
}

function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  // A rule line closes the "collecting user-agents" phase; the next User-agent starts a new group.
  let expectingAgents = false;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!expectingAgents || current === undefined) {
        current = { agents: [], rules: [] };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (current === undefined) continue;
      expectingAgents = false;
      current.rules.push({ field, path: value });
    }
  }
  return groups;
}

/** The group a crawler obeys: an exact User-agent match wins, else the `*` fallback group. */
function effectiveGroup(groups: RobotsGroup[], agent: string): RobotsGroup | undefined {
  const lower = agent.toLowerCase();
  return groups.find((g) => g.agents.includes(lower)) ?? groups.find((g) => g.agents.includes('*'));
}

/** Whether the crawler's effective group blocks the whole site (`Disallow: /` with no override). */
function isDisallowedFromRoot(groups: RobotsGroup[], agent: string): boolean {
  const group = effectiveGroup(groups, agent);
  if (group === undefined) return false;
  const blocksRoot = group.rules.some((r) => r.field === 'disallow' && r.path === '/');
  const allowsRoot = group.rules.some((r) => r.field === 'allow' && r.path === '/');
  // An equal-length Allow wins over a Disallow (Google's longest-match rule; equal → allow).
  return blocksRoot && !allowsRoot;
}

describe('born-passing: generated robots.txt', () => {
  it('never leaves a named AI crawler covered by a Disallow: /', () => {
    const result = scaffoldRobots({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      sitemapFound: true,
      warn,
    });
    expect(result.action).toBe('created');

    const groups = parseRobots(readFileSync(join(dir, 'public', 'robots.txt'), 'utf8'));

    // gptbot / claudebot / google-extended each get their own Allow group; ccbot is only shown
    // commented out, so it falls back to the wildcard group's Allow: /.
    for (const agent of ['gptbot', 'claudebot', 'ccbot', 'google-extended']) {
      expect(isDisallowedFromRoot(groups, agent)).toBe(false);
    }
  });

  it('the parser catches a genuinely blocked crawler (guards against a vacuous assertion)', () => {
    const groups = parseRobots('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n');
    expect(isDisallowedFromRoot(groups, 'gptbot')).toBe(true);
    // A crawler with no specific group falls through to the wildcard Allow.
    expect(isDisallowedFromRoot(groups, 'claudebot')).toBe(false);
  });
});
