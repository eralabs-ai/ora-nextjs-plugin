import { afterEach, describe, expect, it } from 'vitest';

import {
  buildArtifactUrl,
  hostnameFromUrl,
  readSiteUrlFromEnv,
  resolveSiteUrl,
} from '../src/site-url.js';

describe('resolveSiteUrl', () => {
  it('prefers an explicit configSiteUrl over a detected domain', () => {
    expect(
      resolveSiteUrl({
        configSiteUrl: 'https://config.example.com',
        detectedDomain: 'vercel.example.com',
      }),
    ).toBe('https://config.example.com');
  });

  it('prefers configSiteUrl over an env URL and a detected domain', () => {
    expect(
      resolveSiteUrl({
        configSiteUrl: 'https://config.example.com',
        envSiteUrl: 'https://env.example.com',
        detectedDomain: 'vercel.example.com',
      }),
    ).toBe('https://config.example.com');
  });

  it('prefers an env URL over a detected domain when no config is set', () => {
    expect(
      resolveSiteUrl({
        envSiteUrl: 'https://env.example.com',
        detectedDomain: 'vercel.example.com',
      }),
    ).toBe('https://env.example.com');
  });

  it('strips a trailing slash and trims whitespace from an env URL', () => {
    expect(resolveSiteUrl({ envSiteUrl: '  https://env.example.com/  ' })).toBe(
      'https://env.example.com',
    );
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

  it('returns undefined when none is available', () => {
    expect(resolveSiteUrl({})).toBeUndefined();
  });
});

describe('readSiteUrlFromEnv', () => {
  const originalSiteUrl = process.env.SITE_URL;
  const originalPublic = process.env.NEXT_PUBLIC_SITE_URL;

  afterEach(() => {
    restore('SITE_URL', originalSiteUrl);
    restore('NEXT_PUBLIC_SITE_URL', originalPublic);
  });

  it('reads SITE_URL when set', () => {
    process.env.SITE_URL = 'https://site.example.com';
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(readSiteUrlFromEnv()).toBe('https://site.example.com');
  });

  it('falls back to NEXT_PUBLIC_SITE_URL when SITE_URL is unset', () => {
    delete process.env.SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://public.example.com';
    expect(readSiteUrlFromEnv()).toBe('https://public.example.com');
  });

  it('prefers SITE_URL over NEXT_PUBLIC_SITE_URL when both are set', () => {
    process.env.SITE_URL = 'https://site.example.com';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://public.example.com';
    expect(readSiteUrlFromEnv()).toBe('https://site.example.com');
  });

  it('returns undefined when neither is set or both are blank', () => {
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(readSiteUrlFromEnv()).toBeUndefined();
    process.env.SITE_URL = '   ';
    expect(readSiteUrlFromEnv()).toBeUndefined();
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

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
