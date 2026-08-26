import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectSkills, type DetectSkillsOptions } from '../src/detect-skills.js';

let dir: string;
let warnings: string[];
let recommendations: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-detect-skills-'));
  warnings = [];
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

const SKILL = `---\ndescription: A skill\n---\n\n# A\n\nBody.\n`;

function detect(overrides: Partial<DetectSkillsOptions> = {}) {
  return detectSkills({
    cwd: dir,
    publishSkills: false,
    siteUrl: 'https://example.com',
    basePath: '',
    warn: (m) => warnings.push(m),
    recommend: (m) => recommendations.push(m),
    ...overrides,
  });
}

describe('detectSkills — candidate scanning', () => {
  it('separates repo candidates from .claude candidates, sorted, one level deep', () => {
    write(join('skills', 'b', 'SKILL.md'), SKILL);
    write(join('skills', 'a', 'SKILL.md'), SKILL);
    write(join('skills', 'not-a-skill', 'README.md'), 'no skill here');
    write(join('skills', 'nested', 'deeper', 'SKILL.md'), SKILL); // two levels deep — ignored
    write(join('.claude', 'skills', 'c', 'SKILL.md'), SKILL);

    const result = detect({ publishSkills: false });
    expect(result.repoCandidates.map((c) => c.name)).toEqual(['a', 'b']);
    expect(result.claudeCandidates.map((c) => c.name)).toEqual(['c']);
    expect(result.repoCandidates[0]?.skillMdPath).toBe(join('skills', 'a', 'SKILL.md'));
  });
});

describe('detectSkills — selection', () => {
  it('publishSkills true publishes every repo skill but never a .claude one', () => {
    write(join('skills', 'a', 'SKILL.md'), SKILL);
    write(join('.claude', 'skills', 'c', 'SKILL.md'), SKILL);

    const result = detect({ publishSkills: true });
    expect(result.found).toBe(true);
    expect(result.plan?.skills.map((s) => s.name)).toEqual(['a']);
  });

  it('publishSkills true with only .claude skills selects nothing (no plan, not found)', () => {
    write(join('.claude', 'skills', 'c', 'SKILL.md'), SKILL);

    const result = detect({ publishSkills: true });
    expect(result.found).toBe(false);
    expect(result.plan).toBeUndefined();
    expect(result.claudeCandidates.map((c) => c.name)).toEqual(['c']);
  });

  it('a string[] selects explicit paths, including a .claude skill', () => {
    write(join('skills', 'a', 'SKILL.md'), SKILL);
    write(join('.claude', 'skills', 'c', 'SKILL.md'), SKILL);

    const result = detect({ publishSkills: ['skills/a', '.claude/skills/c'] });
    expect(result.found).toBe(true);
    expect(result.plan?.skills.map((s) => s.name).sort()).toEqual(['a', 'c']);
  });

  it('warns and skips a listed path with no SKILL.md', () => {
    const result = detect({ publishSkills: ['skills/nope'] });
    expect(result.found).toBe(false);
    expect(result.plan).toBeUndefined();
    expect(warnings.some((w) => w.includes('skills/nope/SKILL.md does not exist'))).toBe(true);
  });
});

describe('detectSkills — pre-existing served index', () => {
  it('references a served index.json even when publishSkills is off, without planning', () => {
    write(
      join('public', '.well-known', 'agent-skills', 'index.json'),
      `${JSON.stringify({ $schema: 'x', skills: [] }, null, 2)}\n`,
    );

    const result = detect({ publishSkills: false });
    expect(result.found).toBe(true);
    expect(result.source).toBe(join('public', '.well-known', 'agent-skills', 'index.json'));
    expect(result.plan).toBeUndefined();
  });
});

describe('detectSkills — recommendation', () => {
  it('nudges toward publishSkills when repo skills exist but nothing serves them', () => {
    write(join('skills', 'a', 'SKILL.md'), SKILL);

    const result = detect({ publishSkills: false });
    expect(result.found).toBe(false);
    expect(recommendations.some((r) => r.includes('publishSkills: true'))).toBe(true);
  });
});

describe('detectSkills — catalog entry', () => {
  it('emits an entry only when a site URL is known', () => {
    write(join('skills', 'a', 'SKILL.md'), SKILL);

    const result = detect({ publishSkills: true, siteUrl: 'https://example.com' });
    expect(result.entry).toMatchObject({
      identifier: 'urn:air:example.com:agent-skills',
      type: 'application/agent-skills+json',
      displayName: 'Agent skills',
      url: 'https://example.com/.well-known/agent-skills/index.json',
    });
  });

  it('is found without a site URL but emits no entry', () => {
    write(join('skills', 'a', 'SKILL.md'), SKILL);

    const result = detect({ publishSkills: true, siteUrl: undefined });
    expect(result.found).toBe(true);
    expect(result.plan?.skills.map((s) => s.name)).toEqual(['a']);
    expect(result.entry).toBeUndefined();
  });
});
