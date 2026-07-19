import { describe, expect, it } from 'vitest';

import { buildArtifactUrl, hostnameFromUrl, resolveSiteUrl } from '../src/site-url.js';

describe('resolveSiteUrl', () => {
  it('prefers an explicit configSiteUrl over a detected domain', () => {
    expect(
      resolveSiteUrl({
        configSiteUrl: 'https://config.example.com',
        detectedDomain: 'vercel.example.com',
      }),
    ).toBe('https://config.example.com');
  });

  it('strips a trailing slash from configSiteUrl', () => {
    expect(resolveSiteUrl({ configSiteUrl: 'https://example.com/' })).toBe('https://example.com');
  });

  it('trims whitespace from configSiteUrl', () => {
    expect(resolveSiteUrl({ configSiteUrl: '  https://example.com  ' })).toBe(
      'https://example.com',
    );
  });

  it('falls back to https://<detectedDomain> when no configSiteUrl is set', () => {
    expect(resolveSiteUrl({ detectedDomain: 'example.com' })).toBe('https://example.com');
  });

  it('returns undefined when neither is available', () => {
    expect(resolveSiteUrl({})).toBeUndefined();
  });
});

describe('buildArtifactUrl', () => {
  it('joins siteUrl + pathname with no basePath', () => {
    expect(buildArtifactUrl('https://example.com', '', '/openapi.json')).toBe(
      'https://example.com/openapi.json',
    );
  });

  it('inserts basePath between siteUrl and pathname', () => {
    expect(buildArtifactUrl('https://example.com', '/app', '/openapi.json')).toBe(
      'https://example.com/app/openapi.json',
    );
  });

  it('treats a basePath of "/" the same as no basePath', () => {
    expect(buildArtifactUrl('https://example.com', '/', '/llms.txt')).toBe(
      'https://example.com/llms.txt',
    );
  });

  it('strips a trailing slash from siteUrl and basePath', () => {
    expect(buildArtifactUrl('https://example.com/', '/app/', '/llms.txt')).toBe(
      'https://example.com/app/llms.txt',
    );
  });
});

describe('hostnameFromUrl', () => {
  it('extracts the hostname from an absolute URL', () => {
    expect(hostnameFromUrl('https://example.com/path')).toBe('example.com');
  });

  it('returns undefined for an unparseable URL', () => {
    expect(hostnameFromUrl('not a url')).toBeUndefined();
  });
});
