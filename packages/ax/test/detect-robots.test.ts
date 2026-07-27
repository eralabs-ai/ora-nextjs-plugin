import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectRobots } from '../src/detect-robots.js';

let dir: string;
let recommendations: string[];
const recommend = (message: string): void => {
  recommendations.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-detect-robots-'));
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectRobots', () => {
  it('detects a static public/robots.txt', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');

    const result = detectRobots({ cwd: dir, recommend });

    expect(result.found).toBe(true);
    expect(result.source).toBe(join(dir, 'public', 'robots.txt'));
    expect(recommendations.some((r) => r.includes('robots.txt detected'))).toBe(true);
    expect(recommendations.some((r) => r.includes('never'))).toBe(true);
  });

  it('detects an App Router app/robots.ts', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'robots.ts'), 'export default function robots() {}\n', 'utf8');

    const result = detectRobots({ cwd: dir, recommend });

    expect(result.found).toBe(true);
    expect(result.source).toBe(join(dir, 'app', 'robots.ts'));
  });

  it('prefers a static public/robots.txt over an app/robots.ts when both exist', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'robots.txt'), 'User-agent: *\n', 'utf8');
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'robots.ts'), 'export default function robots() {}\n', 'utf8');

    const result = detectRobots({ cwd: dir, recommend });
    expect(result.source).toBe(join(dir, 'public', 'robots.txt'));
  });

  it('recommends adding one, scoped and never "User-agent: *", when absent', () => {
    const result = detectRobots({ cwd: dir, recommend });

    expect(result.found).toBe(false);
    expect(result.source).toBeUndefined();
    const message = recommendations.join('\n');
    expect(message).toContain('No robots.txt found');
    expect(message).toContain('User-agent: *');
    expect(message).toContain('Agentmap:');
  });
});
