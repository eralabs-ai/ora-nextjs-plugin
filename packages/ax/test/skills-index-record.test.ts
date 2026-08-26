import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSkillsIndexRecord } from '../src/skills-index-record.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-skills-index-record-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

/** The exact JSON serialization ax writes for the index (pretty-printed, trailing newline). */
function indexBody(skills: Array<Record<string, unknown>>): string {
  return `${JSON.stringify({ $schema: 'x', skills }, null, 2)}\n`;
}

const STATIC_PATH = join('public', '.well-known', 'agent-skills', 'index.json');
const ROUTE_DIR = join('app', '.well-known', 'agent-skills', 'index.json');

describe('readSkillsIndexRecord', () => {
  it('reads name + digest from the static index.json', () => {
    write(
      STATIC_PATH,
      indexBody([
        { name: 'getting-started', type: 'skill-md', digest: 'sha256:aaa' },
        { name: 'advanced', type: 'skill-md', digest: 'sha256:bbb' },
      ]),
    );

    expect(readSkillsIndexRecord(dir)).toEqual([
      { name: 'getting-started', digest: 'sha256:aaa' },
      { name: 'advanced', digest: 'sha256:bbb' },
    ]);
  });

  it('reads the index embedded in a route-handler emission', () => {
    const body = indexBody([{ name: 'getting-started', type: 'skill-md', digest: 'sha256:ccc' }]);
    write(
      join(ROUTE_DIR, 'route.ts'),
      "export const dynamic = 'force-static';\n\n" +
        `const body = ${JSON.stringify(body)};\n\n` +
        'export function GET(): Response {\n  return new Response(body);\n}\n',
    );

    expect(readSkillsIndexRecord(dir)).toEqual([{ name: 'getting-started', digest: 'sha256:ccc' }]);
  });

  it('prefers the static index over a route handler when both exist', () => {
    write(STATIC_PATH, indexBody([{ name: 'static', digest: 'sha256:static' }]));
    const body = indexBody([{ name: 'route', digest: 'sha256:route' }]);
    write(join(ROUTE_DIR, 'route.ts'), `const body = ${JSON.stringify(body)};\n`);

    expect(readSkillsIndexRecord(dir)).toEqual([{ name: 'static', digest: 'sha256:static' }]);
  });

  it('skips entries missing a name or digest, keeping the well-formed ones', () => {
    write(
      STATIC_PATH,
      indexBody([
        { name: 'ok', digest: 'sha256:ok' },
        { name: 'no-digest' },
        { digest: 'sha256:no-name' },
        { name: '', digest: 'sha256:empty-name' },
      ]),
    );

    expect(readSkillsIndexRecord(dir)).toEqual([{ name: 'ok', digest: 'sha256:ok' }]);
  });

  it('returns [] for a malformed index.json', () => {
    write(STATIC_PATH, '{ this is not json');
    expect(readSkillsIndexRecord(dir)).toEqual([]);
  });

  it('returns [] when the index has no skills array', () => {
    write(STATIC_PATH, `${JSON.stringify({ $schema: 'x' }, null, 2)}\n`);
    expect(readSkillsIndexRecord(dir)).toEqual([]);
  });

  it('returns [] when no index is present', () => {
    expect(readSkillsIndexRecord(dir)).toEqual([]);
  });
});
