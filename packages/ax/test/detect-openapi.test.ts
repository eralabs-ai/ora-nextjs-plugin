import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectOpenApi } from '../src/detect-openapi.js';

let dir: string;
let warnings: string[];
const warn = (message: string): void => {
  warnings.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-detect-openapi-'));
  warnings = [];
  mkdirSync(join(dir, 'public'), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeDoc(contents: string): void {
  writeFileSync(join(dir, 'public', 'openapi.json'), contents, 'utf8');
}

describe('detectOpenApi', () => {
  it('returns undefined when public/openapi.json does not exist', () => {
    expect(
      detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn }),
    ).toBeUndefined();
  });

  it('emits an entry referencing /openapi.json for a valid OpenAPI 3.1 doc', () => {
    writeDoc(
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Example API', description: 'A minimal API.' },
      }),
    );

    const entry = detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn });

    expect(entry).toMatchObject({
      identifier: 'urn:air:example.com:openapi',
      type: 'application/vnd.oai.openapi+json;version=3.1',
      displayName: 'Example API',
      description: 'A minimal API.',
      url: 'https://example.com/openapi.json',
    });
    expect(typeof entry?.updatedAt).toBe('string');
  });

  it('respects basePath when building the URL', () => {
    writeDoc(JSON.stringify({ openapi: '3.0.3', info: {} }));
    const entry = detectOpenApi({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '/app',
      warn,
    });
    expect(entry?.url).toBe('https://example.com/app/openapi.json');
    expect(entry?.type).toBe('application/vnd.oai.openapi+json;version=3.0');
  });

  it('defaults displayName to "OpenAPI" when info.title is absent', () => {
    writeDoc(JSON.stringify({ openapi: '3.1.0' }));
    const entry = detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn });
    expect(entry?.displayName).toBe('OpenAPI');
  });

  it('warns and returns undefined for invalid JSON', () => {
    writeDoc('{ not valid json');
    const entry = detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn });
    expect(entry).toBeUndefined();
    expect(warnings.some((w) => w.includes('not valid JSON'))).toBe(true);
  });

  it('warns and returns undefined for a non-3.x "openapi" field', () => {
    writeDoc(JSON.stringify({ openapi: '2.0', info: {} }));
    const entry = detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn });
    expect(entry).toBeUndefined();
    expect(warnings.some((w) => w.includes('does not look like an OpenAPI 3.x document'))).toBe(
      true,
    );
  });

  it('warns and returns undefined when the "openapi" field is missing entirely', () => {
    writeDoc(JSON.stringify({ info: { title: 'No version field' } }));
    const entry = detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn });
    expect(entry).toBeUndefined();
  });

  it('never fails the build — malformed JSON just yields no entry, not a throw', () => {
    writeDoc('not json at all {{{');
    expect(() =>
      detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn }),
    ).not.toThrow();
  });

  it('warns and skips emitting the entry when no siteUrl is known, even for a valid doc', () => {
    writeDoc(JSON.stringify({ openapi: '3.1.0', info: {} }));
    const entry = detectOpenApi({ cwd: dir, siteUrl: undefined, basePath: '', warn });
    expect(entry).toBeUndefined();
    expect(warnings.some((w) => w.includes('no site URL is known'))).toBe(true);
  });
});

describe('detectOpenApi recommendations', () => {
  let recommendations: string[];
  const recommend = (message: string): void => {
    recommendations.push(message);
  };

  beforeEach(() => {
    recommendations = [];
  });

  it('recommends adding an OpenAPI doc (pointing at the conventional path) when none is present', () => {
    detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn, recommend });
    const joined = recommendations.join('\n');
    expect(joined).toContain('No OpenAPI doc found');
    expect(joined).toContain('public/openapi.json');
    // No third-party package names — the plugin shouldn't couple to their lifecycles.
    expect(joined).not.toContain('zod-openapi');
    expect(joined).not.toContain('next-swagger-doc');
  });

  it('does not recommend "add one" when a doc already exists', () => {
    writeDoc(JSON.stringify({ openapi: '3.1.0', info: {} }));
    detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn, recommend });
    expect(recommendations.some((r) => r.includes('No OpenAPI doc found'))).toBe(false);
  });

  it('nudges toward declaring securitySchemes when a doc declares none', () => {
    writeDoc(JSON.stringify({ openapi: '3.1.0', info: {} }));
    detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn, recommend });
    expect(recommendations.some((r) => r.includes('securitySchemes'))).toBe(true);
  });

  it('does not nudge about securitySchemes when the doc declares them', () => {
    writeDoc(
      JSON.stringify({
        openapi: '3.1.0',
        info: {},
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      }),
    );
    detectOpenApi({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn, recommend });
    expect(recommendations.some((r) => r.includes('securitySchemes'))).toBe(false);
  });
});
