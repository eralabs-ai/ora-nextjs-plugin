import { describe, expect, it } from 'vitest';

import type { McpMount } from '../src/detect-mcp.js';
import { buildMcpServerCardPlan, mountServerName } from '../src/server-card.js';
import type { SiteMetadata } from '../src/site-metadata.js';

const site: SiteMetadata = {
  displayName: 'Demo App',
  description: 'A demo app.',
  version: '1.2.3',
};

function mount(overrides: Partial<McpMount> = {}): McpMount {
  return {
    filePath: '/tmp/app/[transport]/route.ts',
    pathname: '/mcp',
    capabilities: ['roll_dice'],
    ...overrides,
  };
}

describe('mountServerName', () => {
  it('slugifies the mount pathname into a per-server name', () => {
    expect(mountServerName('/mcp')).toBe('mcp');
    expect(mountServerName('/api/public/mcp')).toBe('api-public-mcp');
    expect(mountServerName('/API/mcp')).toBe('api-mcp');
  });

  it('falls back to a generic name for a pathname with no usable characters', () => {
    expect(mountServerName('/')).toBe('mcp-server');
  });
});

describe('buildMcpServerCardPlan', () => {
  it('returns undefined when there are no mounts', () => {
    expect(
      buildMcpServerCardPlan({ mounts: [], siteUrl: 'https://example.com', basePath: '', site }),
    ).toBeUndefined();
  });

  it('returns undefined (silently) when no siteUrl is known — buildMcpEntries already warns', () => {
    expect(
      buildMcpServerCardPlan({ mounts: [mount()], siteUrl: undefined, basePath: '', site }),
    ).toBeUndefined();
  });

  it('builds a single-mount plan: one primary card, no named slots, site-level identity', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [mount()],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
    });

    expect(plan?.multi).toBe(false);
    expect(plan?.cards).toHaveLength(1);
    expect(plan?.cards[0]).toMatchObject({
      mountPathname: '/mcp',
      serverName: 'mcp',
      primary: true,
    });
    expect(plan?.cards[0]?.card).toEqual({
      name: 'com.example/demo-app',
      description: 'A demo app.',
      version: '1.2.3',
      serverUrl: 'https://example.com/mcp',
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
      tools: [{ name: 'roll_dice' }],
      serverInfo: { name: 'Demo App', version: '1.2.3' },
      transport: { type: 'streamable-http', endpoint: 'https://example.com/mcp' },
      capabilities: { tools: {} },
    });
  });

  it('respects basePath in the serverUrl, remotes, and transport.endpoint', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [mount()],
      siteUrl: 'https://example.com',
      basePath: '/app',
      site,
    });
    const card = plan?.cards[0]?.card;
    expect(card?.serverUrl).toBe('https://example.com/app/mcp');
    expect(card?.remotes[0]?.url).toBe('https://example.com/app/mcp');
    expect(card?.transport.endpoint).toBe('https://example.com/app/mcp');
  });

  it('falls back to a generated description and 0.0.0 version when package.json omits them', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [mount()],
      siteUrl: 'https://example.com',
      basePath: '',
      site: { displayName: 'Demo App' },
    });
    expect(plan?.cards[0]?.card.description).toBe('Demo App MCP server');
    expect(plan?.cards[0]?.card.version).toBe('0.0.0');
  });

  it('emits an empty tools array when the mount has no detected capabilities', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [mount({ capabilities: [] })],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
    });
    expect(plan?.cards[0]?.card.tools).toEqual([]);
  });

  it('builds one card per mount when several servers are mounted, each with its own identity', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [
        mount({ pathname: '/api/public/mcp' }),
        mount({ pathname: '/api/mcp', auth: { status: 'unknown' } }),
      ],
      primaryPathname: '/api/public/mcp',
      siteUrl: 'https://example.com',
      basePath: '',
      site,
    });

    expect(plan?.multi).toBe(true);
    expect(plan?.cards).toHaveLength(2);
    // Primary first.
    expect(plan?.cards[0]).toMatchObject({
      mountPathname: '/api/public/mcp',
      serverName: 'api-public-mcp',
      primary: true,
    });
    expect(plan?.cards[0]?.card).toMatchObject({
      name: 'com.example/api-public-mcp',
      description: 'Demo App MCP server at /api/public/mcp',
      serverUrl: 'https://example.com/api/public/mcp',
    });
    expect(plan?.cards[1]).toMatchObject({
      mountPathname: '/api/mcp',
      serverName: 'api-mcp',
      primary: false,
    });
    expect(plan?.cards[1]?.card.authentication).toEqual({ required: true });
  });

  it('falls back to the first mount as primary when primaryPathname matches no mount', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [mount({ pathname: '/api/a' }), mount({ pathname: '/api/b' })],
      primaryPathname: '/api/gone',
      siteUrl: 'https://example.com',
      basePath: '',
      site,
    });
    expect(plan?.cards[0]).toMatchObject({ mountPathname: '/api/a', primary: true });
  });

  it('omits the authentication block for an un-gated mount', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [mount()],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
    });
    expect(plan?.cards[0]?.card).not.toHaveProperty('authentication');
  });

  it('adds an authentication block (with the RFC 9728 metadata URL) for a gated mount', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [
        mount({
          auth: { status: 'unknown' },
          resourceMetadataPath: '/.well-known/oauth-protected-resource',
        }),
      ],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
    });
    expect(plan?.cards[0]?.card.authentication).toEqual({
      required: true,
      resourceMetadata: 'https://example.com/.well-known/oauth-protected-resource',
    });
  });

  it('marks a gated mount required even when no resourceMetadataPath literal was found', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [mount({ auth: { status: 'unknown' } })],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
    });
    expect(plan?.cards[0]?.card.authentication).toEqual({ required: true });
  });

  it('reverses a multi-label host into reverse-DNS and slugifies the name', () => {
    const plan = buildMcpServerCardPlan({
      mounts: [mount()],
      siteUrl: 'https://mcp.acme-labs.io',
      basePath: '',
      site: { displayName: 'ACME Tools!' },
    });
    expect(plan?.cards[0]?.card.name).toBe('io.acme-labs.mcp/acme-tools');
  });
});
