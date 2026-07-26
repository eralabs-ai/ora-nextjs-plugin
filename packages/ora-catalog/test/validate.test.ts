import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateCatalog, validateCatalogArd } from '../src/validate.js';
import type { AiCatalog } from '../src/types.js';

const upstreamExample = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../spec/examples/upstream-ai-catalog.json', import.meta.url)),
    'utf8',
  ),
) as unknown;

const officialArdExample = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../spec/ard/conformance/examples/basic/ai-catalog.json', import.meta.url),
    ),
    'utf8',
  ),
) as unknown;

/** A minimal hand-written sample the validator must accept. */
const handWrittenSample: AiCatalog = {
  specVersion: '1.0',
  host: { displayName: 'Example App', identifier: 'did:web:example.com' },
  entries: [
    {
      identifier: 'urn:air:example.com:tool:echo',
      type: 'application/mcp-server-card+json',
      displayName: 'Echo',
      description: 'Echoes its input.',
      tags: ['demo'],
      url: 'https://example.com/.well-known/mcp/echo.json',
      updatedAt: '2026-07-16T00:00:00Z',
      publisher: { identifier: 'did:web:example.com', displayName: 'Example Inc.' },
    },
  ],
};

describe('validateCatalog', () => {
  it('accepts the vendored upstream example', () => {
    const result = validateCatalog(upstreamExample);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a hand-written sample catalog', () => {
    expect(validateCatalog(handWrittenSample).valid).toBe(true);
  });

  it('accepts an empty entries array (spec: entries MAY be empty)', () => {
    expect(validateCatalog({ specVersion: '1.0', entries: [] }).valid).toBe(true);
  });

  it('accepts an entry with inline data instead of url', () => {
    const catalog = {
      specVersion: '1.0',
      entries: [{ identifier: 'urn:x', type: 'application/json', data: { hello: 'world' } }],
    };
    expect(validateCatalog(catalog).valid).toBe(true);
  });

  it('accepts null inline data (data present counts, regardless of value)', () => {
    const catalog = {
      specVersion: '1.0',
      entries: [{ identifier: 'urn:x', type: 'application/json', data: null }],
    };
    expect(validateCatalog(catalog).valid).toBe(true);
  });

  it('is permissive about unknown top-level and metadata keys', () => {
    const catalog = {
      specVersion: '1.0',
      entries: [],
      metadata: { 'com.example.custom': { anything: true } },
      somethingFromTheFuture: 42,
    };
    expect(validateCatalog(catalog).valid).toBe(true);
  });

  it('treats type as an open string, not an enum', () => {
    const catalog = {
      specVersion: '1.0',
      entries: [
        { identifier: 'urn:x', type: 'application/x-totally-made-up', url: 'https://x.dev' },
      ],
    };
    expect(validateCatalog(catalog).valid).toBe(true);
  });
});

describe('validateCatalog — rejections (only what the spec forbids)', () => {
  it('rejects a missing specVersion', () => {
    const result = validateCatalog({ entries: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.params.missingProperty === 'specVersion')).toBe(true);
  });

  it('rejects a bad specVersion shape', () => {
    const result = validateCatalog({ specVersion: 'v1', entries: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'pattern')).toBe(true);
  });

  it('rejects an entry missing identifier', () => {
    const result = validateCatalog({
      specVersion: '1.0',
      entries: [{ type: 'application/json', url: 'https://x.dev' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.params.missingProperty === 'identifier')).toBe(true);
  });

  it('rejects an entry with neither url nor data', () => {
    const result = validateCatalog({
      specVersion: '1.0',
      entries: [{ identifier: 'urn:x', type: 'application/json' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'oneOf')).toBe(true);
  });

  it('rejects an entry with BOTH url and data (exactly one required)', () => {
    const result = validateCatalog({
      specVersion: '1.0',
      entries: [
        { identifier: 'urn:x', type: 'application/json', url: 'https://x.dev', data: { a: 1 } },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'oneOf')).toBe(true);
  });

  it('rejects a publisher missing its required displayName', () => {
    const result = validateCatalog({
      specVersion: '1.0',
      entries: [
        {
          identifier: 'urn:x',
          type: 'application/json',
          url: 'https://x.dev',
          publisher: { identifier: 'did:web:x.dev' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a non-object catalog', () => {
    expect(validateCatalog('not a catalog').valid).toBe(false);
    expect(validateCatalog(null).valid).toBe(false);
  });
});

// The strict oracle: the official ARD schema vendored verbatim from ards-project/ard-spec (see
// spec/ard/README.md). This is what writeCatalog gates on — every catalog the plugin emits must
// survive the official conformance tool, which runs this exact schema.
describe('validateCatalogArd (official ARD schema)', () => {
  const validEntry = {
    identifier: 'urn:air:example.com:tool:echo',
    displayName: 'Echo',
    type: 'application/mcp-server-card+json',
    url: 'https://example.com/mcp',
  };

  it('accepts the vendored official ARD example manifest', () => {
    const result = validateCatalogArd(officialArdExample);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('the official example also passes the permissive base check (ARD-valid implies base-valid)', () => {
    expect(validateCatalog(officialArdExample).valid).toBe(true);
  });

  it('rejects a non-urn:air identifier (the pre-alignment urn:ora-catalog shape)', () => {
    const catalog = {
      specVersion: '1.0',
      entries: [{ ...validEntry, identifier: 'urn:ora-catalog:openapi' }],
    };
    expect(validateCatalogArd(catalog).valid).toBe(false);
  });

  it('rejects an entry missing displayName (required by ARD, optional in the base spec)', () => {
    const { displayName: _dropped, ...withoutDisplayName } = validEntry;
    const catalog = { specVersion: '1.0', entries: [withoutDisplayName] };
    expect(validateCatalogArd(catalog).valid).toBe(false);
    expect(validateCatalog(catalog).valid).toBe(true);
  });

  it('rejects unknown host keys like description (host is closed in the ARD schema)', () => {
    const catalog = {
      specVersion: '1.0',
      host: { displayName: 'Demo', description: 'A demo app.' },
      entries: [],
    };
    expect(validateCatalogArd(catalog).valid).toBe(false);
    expect(validateCatalog(catalog).valid).toBe(true);
  });

  it('still accepts entry-level extension fields (auth, top-level provenance, ...)', () => {
    const catalog = {
      specVersion: '1.0',
      entries: [
        { ...validEntry, auth: { type: 'oauth2' }, provenance: { basis: 'self-declared' } },
      ],
    };
    expect(validateCatalogArd(catalog).valid).toBe(true);
  });

  it('enforces representativeQueries sizing (2–5)', () => {
    const tooFew = {
      specVersion: '1.0',
      entries: [{ ...validEntry, representativeQueries: ['just one'] }],
    };
    const justRight = {
      specVersion: '1.0',
      entries: [{ ...validEntry, representativeQueries: ['ask one thing', 'ask another'] }],
    };
    expect(validateCatalogArd(tooFew).valid).toBe(false);
    expect(validateCatalogArd(justRight).valid).toBe(true);
  });

  it('the vendored base-spec upstream example does NOT pass ARD (the two layers genuinely differ)', () => {
    // It has an entry without displayName — valid base ai-catalog, not ARD-conformant. This pins
    // the reason both schemas are kept.
    expect(validateCatalog(upstreamExample).valid).toBe(true);
    expect(validateCatalogArd(upstreamExample).valid).toBe(false);
  });
});
