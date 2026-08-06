import { describe, expect, it } from 'vitest';

import { authForOpenApi, safeHttpUrl } from '../src/auth.js';

describe('safeHttpUrl (the secret-guard for URL fields)', () => {
  it('passes http(s) URLs within the length cap', () => {
    expect(safeHttpUrl('https://auth.example.com/token')).toBe('https://auth.example.com/token');
    expect(safeHttpUrl('http://localhost:3000/authorize')).toBe('http://localhost:3000/authorize');
  });

  it('drops non-http(s) schemes, relative values, and overlong strings', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,x')).toBeUndefined();
    expect(safeHttpUrl('/relative/path')).toBeUndefined();
    expect(safeHttpUrl('')).toBeUndefined();
    expect(safeHttpUrl(123)).toBeUndefined();
    expect(safeHttpUrl(`https://x/${'a'.repeat(300)}`)).toBeUndefined();
  });
});

describe('authForOpenApi', () => {
  it('returns status "none" for a doc with no securitySchemes (a declaration, not a guess)', () => {
    expect(authForOpenApi({})).toEqual({ status: 'none' });
    expect(authForOpenApi({ components: {} })).toEqual({ status: 'none' });
    expect(authForOpenApi({ components: { securitySchemes: {} } })).toEqual({ status: 'none' });
  });

  it('maps an apiKey scheme to status "api_key"', () => {
    const auth = authForOpenApi({
      components: { securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
    });
    expect(auth).toEqual({ status: 'api_key' });
  });

  it('maps an http bearer/basic scheme to status "api_key"', () => {
    expect(
      authForOpenApi({
        components: { securitySchemes: { b: { type: 'http', scheme: 'bearer' } } },
      }),
    ).toEqual({ status: 'api_key' });
    expect(
      authForOpenApi({ components: { securitySchemes: { b: { type: 'http', scheme: 'basic' } } } }),
    ).toEqual({ status: 'api_key' });
  });

  it('extracts oauth2 endpoints and scope keys from the preferred flow', () => {
    const auth = authForOpenApi({
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: { 'read:data': 'Read', 'write:data': 'Write' },
              },
            },
          },
        },
      },
    });
    expect(auth).toEqual({
      status: 'oauth2',
      oauth: {
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        scopesSupported: ['read:data', 'write:data'],
      },
    });
  });

  it('treats openIdConnect as oauth2 and lets it win over an apiKey scheme', () => {
    const auth = authForOpenApi({
      components: {
        securitySchemes: {
          key: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://auth.example.com/.well-known' },
        },
      },
    });
    expect(auth?.status).toBe('oauth2');
  });

  it('drops non-http(s) oauth endpoints and caps scopes at 32', () => {
    const scopes = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`scope:${i}`, 'd']));
    const auth = authForOpenApi({
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            flows: {
              implicit: { authorizationUrl: 'javascript:alert(1)', scopes },
            },
          },
        },
      },
    });
    expect(auth?.status).toBe('oauth2');
    expect(auth?.oauth?.authorizationEndpoint).toBeUndefined();
    expect(auth?.oauth?.scopesSupported).toHaveLength(32);
  });
});
