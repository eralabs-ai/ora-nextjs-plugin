import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectAuthProvider } from '../src/detect-auth-provider.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-auth-provider-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePkg(deps: Record<string, string>, devDeps: Record<string, string> = {}): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: deps, devDependencies: devDeps }),
    'utf8',
  );
}

describe('detectAuthProvider', () => {
  it('returns undefined with no package.json or no known provider', () => {
    expect(detectAuthProvider(dir)).toBeUndefined();
    writePkg({ react: '19.0.0' });
    expect(detectAuthProvider(dir)).toBeUndefined();
  });

  it('detects Clerk and notes it can serve OAuth for MCP (no wiring lines)', () => {
    writePkg({ '@clerk/nextjs': '^6.0.0' });
    const provider = detectAuthProvider(dir);
    expect(provider?.name).toBe('clerk');
    expect(provider?.note).toContain('OAuth');
    // Durable note, never version-specific code that would rot with provider API changes.
    expect(provider?.note).not.toContain('import ');
  });

  it('notes that next-auth is human sign-in only, steering to the api_key lane', () => {
    writePkg({ 'next-auth': '^5.0.0' });
    const provider = detectAuthProvider(dir);
    expect(provider?.name).toBe('next-auth');
    expect(provider?.note).toContain('api_key');
  });

  it('reads devDependencies too, and survives malformed package.json', () => {
    writePkg({}, { 'better-auth': '^1.3.0' });
    expect(detectAuthProvider(dir)?.name).toBe('better-auth');
    writeFileSync(join(dir, 'package.json'), '{not json', 'utf8');
    expect(detectAuthProvider(dir)).toBeUndefined();
  });
});
