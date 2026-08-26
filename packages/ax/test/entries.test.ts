import { describe, expect, it } from 'vitest';

import { applyEntryOverrides, entryUrlPath, sanitizeOverrideAuth } from '../src/entries.js';
import type { CatalogEntry } from '../src/types.js';

const mcpEntry: CatalogEntry = {
  identifier: 'urn:demo:mcp',
  type: 'application/mcp-server-card+json',
  displayName: 'Demo MCP server',
  url: '/api/mcp',
};

describe('applyEntryOverrides', () => {
  it('appends a config-declared entry with no matching identifier', () => {
    const { entries, notes } = applyEntryOverrides(
      [],
      [{ identifier: 'urn:demo:docs', type: 'text/html', url: '/docs' }],
    );

    expect(entries).toEqual([{ identifier: 'urn:demo:docs', type: 'text/html', url: '/docs' }]);
    expect(notes[0]).toContain('new entry');
  });

  it('extends (shallow-merges into) an inferred entry with a matching identifier', () => {
    const { entries, notes } = applyEntryOverrides(
      [mcpEntry],
      [{ identifier: 'urn:demo:mcp', description: 'Hand-written description.' }],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      identifier: 'urn:demo:mcp',
      type: 'application/mcp-server-card+json',
      displayName: 'Demo MCP server',
      description: 'Hand-written description.',
    });
    expect(notes[0]).toContain('extended');
  });

  it('never removes an inferred entry that has no matching override', () => {
    const { entries } = applyEntryOverrides([mcpEntry], []);
    expect(entries).toEqual([mcpEntry]);
  });

  it('does not mutate the inferred entries array or its objects', () => {
    const inferred = [{ ...mcpEntry }];
    applyEntryOverrides(inferred, [{ identifier: 'urn:demo:mcp', displayName: 'Overwritten' }]);
    expect(inferred[0]?.displayName).toBe('Demo MCP server');
  });

  it('an override field wins even when both inferred and override set it', () => {
    const { entries } = applyEntryOverrides(
      [mcpEntry],
      [{ identifier: 'urn:demo:mcp', displayName: 'Renamed' }],
    );
    expect(entries[0]?.displayName).toBe('Renamed');
  });

  it('a declared auth wins over a detected one, but a status disagreement is warned', () => {
    const warnings: string[] = [];
    const { entries } = applyEntryOverrides(
      [{ ...mcpEntry, auth: { status: 'api_key' } }],
      [{ identifier: 'urn:demo:mcp', auth: { status: 'oauth2' } }],
      (message) => warnings.push(message),
    );
    expect(entries[0]?.auth).toEqual({ status: 'oauth2' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"oauth2"');
    expect(warnings[0]).toContain('"api_key"');
  });

  it('does not warn when declared and detected auth agree on status', () => {
    const warnings: string[] = [];
    const { entries } = applyEntryOverrides(
      [{ ...mcpEntry, auth: { status: 'unknown' } }],
      [
        {
          identifier: 'urn:demo:mcp',
          auth: { status: 'unknown', docsUrl: 'https://example.com/docs/auth' },
        },
      ],
      (message) => warnings.push(message),
    );
    expect(entries[0]?.auth).toEqual({
      status: 'unknown',
      docsUrl: 'https://example.com/docs/auth',
    });
    expect(warnings).toEqual([]);
  });
});

describe('sanitizeOverrideAuth', () => {
  it('leaves overrides that declare no auth untouched (same object, no copy)', () => {
    const override = { identifier: 'urn:demo:docs', url: '/docs' };
    expect(sanitizeOverrideAuth([override], () => {})[0]).toBe(override);
  });

  it('keeps a valid declared auth and warns nothing', () => {
    const warnings: string[] = [];
    const [result] = sanitizeOverrideAuth(
      [
        {
          identifier: 'urn:demo:api',
          auth: { status: 'oauth2', oauth: { tokenEndpoint: 'https://auth.example.com/token' } },
        },
      ],
      (message) => warnings.push(message),
    );
    expect(result?.auth).toEqual({
      status: 'oauth2',
      oauth: { tokenEndpoint: 'https://auth.example.com/token' },
    });
    expect(warnings).toEqual([]);
  });

  it('strips a non-http(s) URL field with a warning naming the entry and the field', () => {
    const warnings: string[] = [];
    const [result] = sanitizeOverrideAuth(
      [{ identifier: 'urn:demo:api', auth: { status: 'api_key', docsUrl: 'javascript:alert(1)' } }],
      (message) => warnings.push(message),
    );
    expect(result?.auth).toEqual({ status: 'api_key' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('urn:demo:api');
    expect(warnings[0]).toContain('auth.docsUrl');
  });

  it('removes a wholly unusable auth so an inferred descriptor survives the merge', () => {
    const warnings: string[] = [];
    const [result] = sanitizeOverrideAuth(
      // The config schema rejects this at load time; simulate a direct-API caller bypassing it.
      [{ identifier: 'urn:demo:api', auth: { status: 'not-a-status' } } as never],
      (message) => warnings.push(message),
    );
    expect(result).not.toHaveProperty('auth');
    expect(warnings).toHaveLength(1);
  });
});

describe('entryUrlPath', () => {
  it('extracts the pathname from a relative url', () => {
    expect(entryUrlPath({ url: '/api/mcp' })).toBe('/api/mcp');
  });

  it('extracts the pathname from an absolute url', () => {
    expect(entryUrlPath({ url: 'https://example.com/openapi.json' })).toBe('/openapi.json');
  });

  it('returns undefined when there is no url', () => {
    expect(entryUrlPath({})).toBeUndefined();
  });
});
