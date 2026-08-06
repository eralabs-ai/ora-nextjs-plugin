import { describe, expect, it } from 'vitest';

import type { McpMount } from '../src/detect-mcp.js';
import { buildMcpServerCard } from '../src/server-card.js';
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

describe('buildMcpServerCard', () => {
  it('returns undefined when there are no mounts', () => {
    const recs: string[] = [];
    expect(
      buildMcpServerCard({
        mounts: [],
        siteUrl: 'https://example.com',
        basePath: '',
        site,
        recommend: (m) => recs.push(m),
      }),
    ).toBeUndefined();
    expect(recs).toEqual([]);
  });

  it('returns undefined (silently) when no siteUrl is known — buildMcpEntries already warns', () => {
    const recs: string[] = [];
    expect(
      buildMcpServerCard({
        mounts: [mount()],
        siteUrl: undefined,
        basePath: '',
        site,
        recommend: (m) => recs.push(m),
      }),
    ).toBeUndefined();
    expect(recs).toEqual([]);
  });

  it('builds a card from a single mount with all required fields', () => {
    const card = buildMcpServerCard({
      mounts: [mount()],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
      recommend: () => {},
    });

    expect(card).toEqual({
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
    const card = buildMcpServerCard({
      mounts: [mount()],
      siteUrl: 'https://example.com',
      basePath: '/app',
      site,
      recommend: () => {},
    });
    expect(card?.serverUrl).toBe('https://example.com/app/mcp');
    expect(card?.remotes[0]?.url).toBe('https://example.com/app/mcp');
    expect(card?.transport.endpoint).toBe('https://example.com/app/mcp');
  });

  it('falls back to a generated description and 0.0.0 version when package.json omits them', () => {
    const card = buildMcpServerCard({
      mounts: [mount()],
      siteUrl: 'https://example.com',
      basePath: '',
      site: { displayName: 'Demo App' },
      recommend: () => {},
    });
    expect(card?.description).toBe('Demo App MCP server');
    expect(card?.version).toBe('0.0.0');
  });

  it('emits an empty tools array when the mount has no detected capabilities', () => {
    const card = buildMcpServerCard({
      mounts: [mount({ capabilities: [] })],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
      recommend: () => {},
    });
    expect(card?.tools).toEqual([]);
  });

  it('skips (with a recommendation) when more than one MCP server is mounted', () => {
    const recs: string[] = [];
    const card = buildMcpServerCard({
      mounts: [mount(), mount({ pathname: '/api/tools' })],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
      recommend: (m) => recs.push(m),
    });
    expect(card).toBeUndefined();
    expect(recs.some((r) => r.includes('2 MCP server mounts'))).toBe(true);
  });

  it('omits the authentication block for an un-gated mount', () => {
    const card = buildMcpServerCard({
      mounts: [mount()],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
      recommend: () => {},
    });
    expect(card).not.toHaveProperty('authentication');
  });

  it('adds an authentication block (with the RFC 9728 metadata URL) for a gated mount', () => {
    const card = buildMcpServerCard({
      mounts: [
        mount({
          auth: { status: 'unknown' },
          resourceMetadataPath: '/.well-known/oauth-protected-resource',
        }),
      ],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
      recommend: () => {},
    });
    expect(card?.authentication).toEqual({
      required: true,
      resourceMetadata: 'https://example.com/.well-known/oauth-protected-resource',
    });
  });

  it('marks a gated mount required even when no resourceMetadataPath literal was found', () => {
    const card = buildMcpServerCard({
      mounts: [mount({ auth: { status: 'unknown' } })],
      siteUrl: 'https://example.com',
      basePath: '',
      site,
      recommend: () => {},
    });
    expect(card?.authentication).toEqual({ required: true });
  });

  it('reverses a multi-label host into reverse-DNS and slugifies the name', () => {
    const card = buildMcpServerCard({
      mounts: [mount()],
      siteUrl: 'https://mcp.acme-labs.io',
      basePath: '',
      site: { displayName: 'ACME Tools!' },
      recommend: () => {},
    });
    expect(card?.name).toBe('io.acme-labs.mcp/acme-tools');
  });
});
