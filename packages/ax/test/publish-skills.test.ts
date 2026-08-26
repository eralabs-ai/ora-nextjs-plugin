import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planSkillsPublish, type SkillCandidate } from '../src/publish-skills.js';

let dir: string;
let warnings: string[];
const warn = (message: string): void => {
  warnings.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-publish-skills-'));
  warnings = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

/** Writes a source SKILL.md under skills/<name>/ and returns its candidate descriptor. */
function source(name: string, content: string): SkillCandidate {
  const skillMdPath = join('skills', name, 'SKILL.md');
  write(skillMdPath, content);
  return { name, dirPath: join('skills', name), skillMdPath };
}

/** Writes a previously published index.json recording the given name→digest pairs. */
function record(entries: Array<{ name: string; digest: string }>): void {
  write(
    join('public', '.well-known', 'agent-skills', 'index.json'),
    `${JSON.stringify({ $schema: 'x', skills: entries.map((e) => ({ ...e, type: 'skill-md' })) }, null, 2)}\n`,
  );
}

/** Writes a currently-published SKILL.md copy for <name>. */
function published(name: string, content: string): void {
  write(join('public', '.well-known', 'agent-skills', name, 'SKILL.md'), content);
}

const BODY = '# Getting started\n\nDo the thing.\n';

describe('planSkillsPublish — action decisions', () => {
  it('first run (empty record) plans every skill as create and never flags a hand-edit', () => {
    const a = source('a', `---\ndescription: A skill\n---\n\n${BODY}`);
    const b = source('b', `---\ndescription: B skill\n---\n\n${BODY}`);
    // A published copy exists but there's no record — a first run must still create, not skip.
    published('a', 'stale content that differs from source');

    const plan = planSkillsPublish({ cwd: dir, candidates: [a, b], warn });
    expect(plan.skills.map((s) => [s.name, s.action])).toEqual([
      ['a', 'create'],
      ['b', 'create'],
    ]);
    expect(warnings).toEqual([]);
  });

  it('marks a skill update when the source changed and unchanged when it matches the record', () => {
    const changed = `---\ndescription: Updated\n---\n\n# Changed\n\nNew body.\n`;
    const same = `---\ndescription: Same\n---\n\n${BODY}`;
    const a = source('a', changed);
    const b = source('b', same);

    // b's published copy matches its source; a's published copy matches the *old* source.
    const oldA = `---\ndescription: Old\n---\n\n${BODY}`;
    published('a', oldA);
    published('b', same);
    record([
      { name: 'a', digest: sha256(oldA) },
      { name: 'b', digest: sha256(same) },
    ]);

    const plan = planSkillsPublish({ cwd: dir, candidates: [a, b], warn });
    expect(plan.skills.map((s) => [s.name, s.action])).toEqual([
      ['a', 'update'],
      ['b', 'unchanged'],
    ]);
  });

  it('skips a hand-edited published copy, warns, and records the published digest in the index', () => {
    const src = `---\ndescription: A skill\n---\n\n${BODY}`;
    const a = source('a', src);
    const handEdited = `${BODY}\n\nA human added this line.\n`;
    published('a', handEdited);
    // The record digest is the *original* published digest, not the current (edited) one.
    record([{ name: 'a', digest: sha256(BODY) }]);

    const plan = planSkillsPublish({ cwd: dir, candidates: [a], warn });
    expect(plan.skills[0]?.action).toBe('skip-hand-edited');
    // The plan keeps the source content/digest, but the index describes what's actually served.
    expect(plan.skills[0]?.digest).toBe(sha256(src));
    expect(warnings.some((w) => w.includes('was edited after ax published it'))).toBe(true);

    const index = JSON.parse(plan.indexJson) as { skills: Array<{ digest: string }> };
    expect(index.skills[0]?.digest).toBe(sha256(handEdited));
  });

  it('re-publishes (create) a skill whose published file is missing even when a record exists', () => {
    const src = `---\ndescription: A skill\n---\n\n${BODY}`;
    const a = source('a', src);
    // Record present, but no published copy on disk — a missing file is re-published, not hand-edit.
    record([{ name: 'a', digest: sha256('anything') }]);

    const plan = planSkillsPublish({ cwd: dir, candidates: [a], warn });
    expect(plan.skills[0]?.action).toBe('create');
    expect(warnings).toEqual([]);
  });
});

describe('planSkillsPublish — stale dirs', () => {
  it('reports published dirs whose skill is no longer a candidate', () => {
    const a = source('a', `---\ndescription: A\n---\n\n${BODY}`);
    published('a', `---\ndescription: A\n---\n\n${BODY}`);
    record([
      { name: 'a', digest: 'sha256:x' },
      { name: 'gone', digest: 'sha256:y' },
    ]);

    const plan = planSkillsPublish({ cwd: dir, candidates: [a], warn });
    expect(plan.staleDirs).toEqual([join('public', '.well-known', 'agent-skills', 'gone')]);
  });
});

describe('planSkillsPublish — index shape', () => {
  it('renders a v0.2.0 index sorted by name with root-relative urls and skill-md type', () => {
    const b = source('b', `---\ndescription: B skill\n---\n\n${BODY}`);
    const a = source('a', `---\ndescription: A skill\n---\n\n${BODY}`);

    const plan = planSkillsPublish({ cwd: dir, candidates: [b, a], warn });
    expect(plan.servedIndexPath).toBe('/.well-known/agent-skills/index.json');
    expect(plan.indexJson.endsWith('\n')).toBe(true);

    const index = JSON.parse(plan.indexJson) as {
      $schema: string;
      skills: Array<{
        name: string;
        type: string;
        description: string;
        url: string;
        digest: string;
      }>;
    };
    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');
    expect(index.skills).toEqual([
      {
        name: 'a',
        type: 'skill-md',
        description: 'A skill',
        url: '/.well-known/agent-skills/a/SKILL.md',
        digest: sha256(`---\ndescription: A skill\n---\n\n${BODY}`),
      },
      {
        name: 'b',
        type: 'skill-md',
        description: 'B skill',
        url: '/.well-known/agent-skills/b/SKILL.md',
        digest: sha256(`---\ndescription: B skill\n---\n\n${BODY}`),
      },
    ]);
  });
});

describe('planSkillsPublish — frontmatter and description', () => {
  it('uses the frontmatter name over the directory name and reads quoted scalars', () => {
    const candidate = source(
      'dir-name',
      `---\nname: "custom-name"\ndescription: 'A quoted description'\n---\n\n${BODY}`,
    );

    const plan = planSkillsPublish({ cwd: dir, candidates: [candidate], warn });
    expect(plan.skills[0]).toMatchObject({
      name: 'custom-name',
      description: 'A quoted description',
      targetPath: join('public', '.well-known', 'agent-skills', 'custom-name', 'SKILL.md'),
    });
    expect(plan.skills[0]?.content).toContain('name: "custom-name"');
  });

  it('falls back to the first non-heading paragraph and warns when no description frontmatter', () => {
    const candidate = source(
      'a',
      '# Heading to skip\n\nThe first real paragraph describes the skill.\n\nA second paragraph.\n',
    );

    const plan = planSkillsPublish({ cwd: dir, candidates: [candidate], warn });
    expect(plan.skills[0]?.description).toBe('The first real paragraph describes the skill.');
    expect(warnings.some((w) => w.includes('no description frontmatter'))).toBe(true);
  });

  it('rejects a skill whose name is not a valid URL path segment, warning and dropping it', () => {
    const good = source('good', `---\ndescription: Good\n---\n\n${BODY}`);
    const bad: SkillCandidate = (() => {
      const skillMdPath = join('skills', 'bad name', 'SKILL.md');
      write(skillMdPath, `---\ndescription: Bad\n---\n\n${BODY}`);
      return { name: 'bad name', dirPath: join('skills', 'bad name'), skillMdPath };
    })();

    const plan = planSkillsPublish({ cwd: dir, candidates: [good, bad], warn });
    expect(plan.skills.map((s) => s.name)).toEqual(['good']);
    expect(warnings.some((w) => w.includes('not a valid URL path segment'))).toBe(true);
  });
});
