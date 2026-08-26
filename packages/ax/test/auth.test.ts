import { describe, expect, it } from 'vitest';

import {
  authForOpenApi,
  credentialQueryParam,
  safeHttpUrl,
  sanitizeDeclaredAuth,
} from '../src/auth.js';

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

describe('sanitizeDeclaredAuth (config-declared descriptors get the detection discipline)', () => {
  it('passes a full valid descriptor through unchanged', () => {
    const declared = {
      status: 'oauth2',
      oauth: {
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        registrationEndpoint: 'https://auth.example.com/register',
        scopesSupported: ['read:data'],
        grantTypesSupported: ['authorization_code'],
        dcr: true,
      },
      docsUrl: 'https://example.com/docs/auth',
    };
    const { auth, dropped } = sanitizeDeclaredAuth(declared);
    expect(auth).toEqual(declared);
    expect(dropped).toEqual([]);
  });

  it('returns no descriptor at all for a non-object or an unknown status', () => {
    expect(sanitizeDeclaredAuth('oauth2')).toEqual({ dropped: ['auth is not an object'] });
    const { auth, dropped } = sanitizeDeclaredAuth({ status: 'basic' });
    expect(auth).toBeUndefined();
    expect(dropped[0]).toContain('"basic"');
  });

  it('drops non-http(s) URL fields (the secret-guard) but keeps the rest, reporting each drop', () => {
    const { auth, dropped } = sanitizeDeclaredAuth({
      status: 'oauth2',
      oauth: {
        authorizationEndpoint: 'javascript:alert(1)',
        tokenEndpoint: 'https://auth.example.com/token',
      },
      docsUrl: '/relative/docs',
    });
    expect(auth).toEqual({
      status: 'oauth2',
      oauth: { tokenEndpoint: 'https://auth.example.com/token' },
    });
    expect(dropped).toHaveLength(2);
    expect(dropped.join('\n')).toContain('auth.oauth.authorizationEndpoint');
    expect(dropped.join('\n')).toContain('auth.docsUrl');
  });

  it('caps scope lists and filters non-string members, reporting the trim', () => {
    const { auth, dropped } = sanitizeDeclaredAuth({
      status: 'oauth2',
      oauth: { scopesSupported: [...Array.from({ length: 40 }, (_, i) => `s:${i}`), 42] },
    });
    expect(auth?.oauth?.scopesSupported).toHaveLength(32);
    expect(dropped.join('\n')).toContain('auth.oauth.scopesSupported');
  });

  it('never carries unknown fields — only the EntryAuth shape crosses', () => {
    const { auth } = sanitizeDeclaredAuth({
      status: 'api_key',
      apiKey: 'sk-secret-value',
      note: 'send this header',
    });
    expect(auth).toEqual({ status: 'api_key' });
  });
});

describe('credentialQueryParam (the embedded-secret half of the guard)', () => {
  it('flags credential-like query parameters by name', () => {
    expect(credentialQueryParam('https://x.com/docs?api_key=sk-live-123')).toBe('api_key');
    expect(credentialQueryParam('https://x.com/a?token=abc')).toBe('token');
    expect(credentialQueryParam('https://x.com/a?client_secret=s')).toBe('client_secret');
  });

  it('passes clean URLs, including ones with ordinary query parameters', () => {
    expect(credentialQueryParam('https://x.com/docs')).toBeUndefined();
    expect(credentialQueryParam('https://x.com/docs?page=2&lang=en')).toBeUndefined();
  });

  it('sanitizeDeclaredAuth drops a URL field embedding a credential, naming the parameter', () => {
    const { auth, dropped } = sanitizeDeclaredAuth({
      status: 'api_key',
      docsUrl: 'https://x.com/docs?api_key=sk-live-123',
    });
    expect(auth).toEqual({ status: 'api_key' });
    expect(dropped.join('\n')).toContain('"api_key="');
  });
});
