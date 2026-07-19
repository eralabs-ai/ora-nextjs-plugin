import { describe, expect, it } from 'vitest';

import { isPathDenied, matchesAnyGlob } from '../src/denylist.js';

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

describe('isPathDenied', () => {
  it('denies a path matching the denylist', () => {
    expect(isPathDenied('/api/auth/login', ['/api/auth/**'], [])).toBe(true);
  });

  it('does not deny a path outside the denylist', () => {
    expect(isPathDenied('/api/public', ['/api/auth/**'], [])).toBe(false);
  });

  it('lets the allowlist re-include a denylisted path', () => {
    expect(isPathDenied('/api/auth/status', ['/api/auth/**'], ['/api/auth/status'])).toBe(false);
  });

  it('allowlist only re-includes what it explicitly matches', () => {
    expect(isPathDenied('/api/auth/login', ['/api/auth/**'], ['/api/auth/status'])).toBe(true);
  });
});
