import { describe, expect, it } from 'vitest';

import { buildDiscoveryRecommendations, catalogServedPath } from '../src/discovery.js';

describe('catalogServedPath', () => {
  it('is the conventional root path with no basePath', () => {
    expect(catalogServedPath('')).toBe('/.well-known/ai-catalog.json');
    expect(catalogServedPath('/')).toBe('/.well-known/ai-catalog.json');
  });

  it('is prefixed under a basePath', () => {
    expect(catalogServedPath('/app')).toBe('/app/.well-known/ai-catalog.json');
    expect(catalogServedPath('/app/')).toBe('/app/.well-known/ai-catalog.json');
  });
});

describe('buildDiscoveryRecommendations', () => {
  it('returns nothing without a basePath — the catalog is already at the root path', () => {
    expect(buildDiscoveryRecommendations({ siteUrl: 'https://example.com', basePath: '' })).toEqual(
      [],
    );
    expect(
      buildDiscoveryRecommendations({ siteUrl: 'https://example.com', basePath: '/' }),
    ).toEqual([]);
  });

  it('recommends an absolute <link> tag and Agentmap: directive when siteUrl is known', () => {
    const messages = buildDiscoveryRecommendations({
      siteUrl: 'https://example.com',
      basePath: '/app',
    });
    const joined = messages.join('\n');
    expect(joined).toContain('/app/.well-known/ai-catalog.json');
    expect(joined).toContain(
      '<link rel="ai-catalog" href="https://example.com/app/.well-known/ai-catalog.json" />',
    );
    expect(joined).toContain('Agentmap: https://example.com/app/.well-known/ai-catalog.json');
  });

  it('falls back to the served (prefixed) path when no siteUrl is known', () => {
    const messages = buildDiscoveryRecommendations({ siteUrl: undefined, basePath: '/app' });
    const joined = messages.join('\n');
    expect(joined).toContain('href="/app/.well-known/ai-catalog.json"');
    expect(joined).not.toContain('https://');
  });
});
