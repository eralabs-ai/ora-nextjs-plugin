import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectAgentsMd } from '../src/detect-agents-md.js';

let dir: string;
let recommendations: string[];
const recommend = (message: string): void => {
  recommendations.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-detect-agents-md-'));
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectAgentsMd', () => {
  it('detects a static public/agents.md', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'agents.md'), '# Agents\n', 'utf8');

    const result = detectAgentsMd({ cwd: dir, recommend });

    expect(result.found).toBe(true);
    expect(result.source).toBe(join(dir, 'public', 'agents.md'));
    expect(recommendations.some((r) => r.includes('agents.md detected'))).toBe(true);
  });

  it('detects an App Router app/agents.md/route.ts', () => {
    const routeDir = join(dir, 'app', 'agents.md');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, 'route.ts'), 'export function GET() {}\n', 'utf8');

    const result = detectAgentsMd({ cwd: dir, recommend });

    expect(result.found).toBe(true);
    expect(result.source).toBe(join(routeDir, 'route.ts'));
  });

  it('recommends adding one (content authored by the skill) when absent', () => {
    const result = detectAgentsMd({ cwd: dir, recommend });

    expect(result.found).toBe(false);
    const message = recommendations.join('\n');
    expect(message).toContain('No agents.md found');
    expect(message).toContain('when-to-use');
    expect(message).toContain('companion skill');
  });
});
