import { describe, expect, it } from 'vitest';

import { applyEntryOverrides, entryUrlPath } from '../src/entries.js';
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
