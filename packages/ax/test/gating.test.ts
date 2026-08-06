import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GATED_GLOBS,
  defaultIsGated,
  matchesAnyGlob,
  resolveGating,
  type GateTarget,
} from '../src/gating.js';

describe('matchesAnyGlob', () => {
  it('matches a literal path', () => {
    expect(matchesAnyGlob('/api/auth/login', ['/api/auth/login'])).toBe(true);
    expect(matchesAnyGlob('/api/auth/logout', ['/api/auth/login'])).toBe(false);
  });

  it('matches ** against any depth', () => {
    expect(matchesAnyGlob('/api/auth/login', ['/api/auth/**'])).toBe(true);
    expect(matchesAnyGlob('/api/auth/oauth/callback', ['/api/auth/**'])).toBe(true);
    expect(matchesAnyGlob('/api/other', ['/api/auth/**'])).toBe(false);
  });

  it('matches * only within a single path segment', () => {
    expect(matchesAnyGlob('/docs/readme.md', ['/docs/*.md'])).toBe(true);
    expect(matchesAnyGlob('/docs/sub/readme.md', ['/docs/*.md'])).toBe(false);
  });

  it('returns false for an empty pattern list', () => {
    expect(matchesAnyGlob('/anything', [])).toBe(false);
  });
});

const target = (path: string): GateTarget => ({ kind: 'entry', path });

describe('defaultIsGated (the built-in floor)', () => {
  it('gates the default auth and webhook globs', () => {
    expect(DEFAULT_GATED_GLOBS).toEqual(['/api/auth/**', '/api/webhooks/**']);
    expect(defaultIsGated(target('/api/auth/login'))).toBe(true);
    expect(defaultIsGated(target('/api/webhooks/stripe'))).toBe(true);
  });

  it('does not gate ordinary paths', () => {
    expect(defaultIsGated(target('/api/products'))).toBe(false);
    expect(defaultIsGated(target('/docs'))).toBe(false);
  });
});

describe('resolveGating', () => {
  it('falls back to the built-in floor when no isGated is supplied', () => {
    const isGated = resolveGating(undefined);
    expect(isGated(target('/api/auth/login'))).toBe(true);
    expect(isGated(target('/public'))).toBe(false);
  });

  it('lets a supplied isGated own the whole policy (replacing, not extending, the floor)', () => {
    // A matcher that gates only /internal and, crucially, re-includes a floor path — the job the
    // old allowlist did — by returning false for it.
    const isGated = resolveGating(({ path }) => path.startsWith('/internal'));
    expect(isGated(target('/internal/x'))).toBe(true);
    // The default floor no longer applies: this matcher does not gate /api/auth/**.
    expect(isGated(target('/api/auth/login'))).toBe(false);
  });

  it('composes the floor back in when the user calls defaultIsGated', () => {
    const isGated = resolveGating((t) => defaultIsGated(t) || t.path.startsWith('/internal'));
    expect(isGated(target('/api/auth/login'))).toBe(true);
    expect(isGated(target('/internal/x'))).toBe(true);
    expect(isGated(target('/public'))).toBe(false);
  });

  it('passes the artifact kind and tools through to the matcher', () => {
    const seen: GateTarget[] = [];
    const isGated = resolveGating((t) => {
      seen.push(t);
      return t.kind === 'mcp';
    });
    expect(isGated({ kind: 'mcp', path: '/api/mcp', tools: ['roll_dice'] })).toBe(true);
    expect(isGated({ kind: 'openapi', path: '/openapi.json' })).toBe(false);
    expect(seen[0]).toEqual({ kind: 'mcp', path: '/api/mcp', tools: ['roll_dice'] });
  });
});
