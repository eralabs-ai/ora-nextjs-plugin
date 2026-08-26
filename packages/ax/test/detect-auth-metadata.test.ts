import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectAuthMetadata } from '../src/detect-auth-metadata.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-auth-meta-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeWellKnown(name: string, content: unknown): void {
  const wellKnown = join(dir, 'public', '.well-known');
  mkdirSync(wellKnown, { recursive: true });
  writeFileSync(join(wellKnown, name), JSON.stringify(content), 'utf8');
}

describe('detectAuthMetadata', () => {
  it('returns an empty suggestion for a project with no committed auth declarations', () => {
    expect(detectAuthMetadata({ cwd: dir })).toEqual({ issuers: [] });
  });

  it('prefills endpoints from a committed RFC 8414 authorization-server metadata document', () => {
    writeWellKnown('oauth-authorization-server', {
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      registration_endpoint: 'https://auth.example.com/register',
      scopes_supported: ['read:data'],
    });

    const suggestion = detectAuthMetadata({ cwd: dir });
    expect(suggestion.oauth).toEqual({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      registrationEndpoint: 'https://auth.example.com/register',
      scopesSupported: ['read:data'],
    });
    expect(suggestion.oauthSource).toBe(
      join('public', '.well-known', 'oauth-authorization-server'),
    );
    expect(suggestion.issuers).toEqual(['https://auth.example.com']);
  });

  it('drops non-http(s) endpoint values from the metadata (the same secret-guard as everywhere)', () => {
    writeWellKnown('oauth-authorization-server.json', {
      authorization_endpoint: 'javascript:alert(1)',
      token_endpoint: 'https://auth.example.com/token',
    });

    const suggestion = detectAuthMetadata({ cwd: dir });
    expect(suggestion.oauth).toEqual({ tokenEndpoint: 'https://auth.example.com/token' });
  });

  it('collects issuers from authServerUrls literals in a route handler (protectedResourceHandler)', () => {
    const routeDir = join(dir, 'app', '.well-known', 'oauth-protected-resource');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "import { protectedResourceHandler } from 'mcp-handler';\n" +
        'const handler = protectedResourceHandler({\n' +
        "  authServerUrls: ['https://clerk.example.com'],\n" +
        '});\n' +
        'export { handler as GET };\n',
      'utf8',
    );

    const suggestion = detectAuthMetadata({ cwd: dir });
    expect(suggestion.oauth).toBeUndefined();
    expect(suggestion.issuers).toEqual(['https://clerk.example.com']);
    expect(suggestion.issuersSource).toBe(
      join('app', '.well-known', 'oauth-protected-resource', 'route.ts'),
    );
  });

  it('ignores an authServerUrls mention that only appears in a comment', () => {
    const routeDir = join(dir, 'app', 'api', 'thing');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "// e.g. authServerUrls: ['https://commented.example.com']\n" +
        'export function GET() { return new Response("ok"); }\n',
      'utf8',
    );

    expect(detectAuthMetadata({ cwd: dir }).issuers).toEqual([]);
  });

  it('collects issuers from a committed RFC 9728 protected-resource metadata document', () => {
    writeWellKnown('oauth-protected-resource', {
      resource: 'https://example.com/mcp',
      authorization_servers: ['https://auth.example.com', 'javascript:alert(1)'],
    });

    const suggestion = detectAuthMetadata({ cwd: dir });
    expect(suggestion.issuers).toEqual(['https://auth.example.com']);
    expect(suggestion.issuersSource).toBe(
      join('public', '.well-known', 'oauth-protected-resource'),
    );
  });

  it('dedupes an issuer declared by several sources, keeping the first source label', () => {
    writeWellKnown('oauth-protected-resource.json', {
      authorization_servers: ['https://auth.example.com'],
    });
    const routeDir = join(dir, 'app', 'api', 'meta');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "const h = protectedResourceHandler({ authServerUrls: ['https://auth.example.com'] });\n" +
        'export { h as GET };\n',
      'utf8',
    );

    const suggestion = detectAuthMetadata({ cwd: dir });
    expect(suggestion.issuers).toEqual(['https://auth.example.com']);
  });
});

describe('resourceMetadataRoute (provider-served RFC 9728 wiring)', () => {
  it('detects a provider-flavored handler with no issuer literal (Clerk derives it from env)', () => {
    const routeDir = join(dir, 'app', '.well-known', 'oauth-protected-resource');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "import { protectedResourceHandlerClerk } from '@clerk/mcp-tools/next';\n" +
        'const handler = protectedResourceHandlerClerk({ scopes_supported: ["email"] });\n' +
        'export { handler as GET };\n',
      'utf8',
    );

    const suggestion = detectAuthMetadata({ cwd: dir });
    expect(suggestion.resourceMetadataRoute).toBe(
      join('app', '.well-known', 'oauth-protected-resource', 'route.ts'),
    );
    expect(suggestion.issuers).toEqual([]);
    expect(suggestion.oauth).toBeUndefined();
  });

  it('sets the route alongside issuers for the plain mcp-handler variant', () => {
    const routeDir = join(dir, 'app', 'api', 'meta');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      "const h = protectedResourceHandler({ authServerUrls: ['https://auth.example.com'] });\n" +
        'export { h as GET };\n',
      'utf8',
    );

    const suggestion = detectAuthMetadata({ cwd: dir });
    expect(suggestion.resourceMetadataRoute).toBe(join('app', 'api', 'meta', 'route.ts'));
    expect(suggestion.issuers).toEqual(['https://auth.example.com']);
  });

  it('ignores a handler mention that only appears in a comment', () => {
    const routeDir = join(dir, 'app', 'api', 'thing');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      '// wire protectedResourceHandlerClerk( here later\n' +
        'export function GET() { return new Response("ok"); }\n',
      'utf8',
    );
    expect(detectAuthMetadata({ cwd: dir }).resourceMetadataRoute).toBeUndefined();
  });
});
