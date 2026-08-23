import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { McpServerCard, McpServerCardPlan } from '../src/server-card.js';
import type { AiCatalog } from '../src/types.js';
import {
  CATALOG_OUTPUT_PATH,
  SERVER_CARD_DIR_OUTPUT_PATH,
  SERVER_CARD_OUTPUT_PATH,
  writeCatalog,
  writeServerCards,
} from '../src/write.js';

let dir: string;

const validCatalog: AiCatalog = {
  specVersion: '1.0',
  host: { displayName: 'Demo' },
  entries: [],
};

function card(pathname: string, name: string): McpServerCard {
  const url = `https://example.com${pathname}`;
  return {
    name: `com.example/${name}`,
    description: 'Demo MCP server',
    version: '1.0.0',
    serverUrl: url,
    remotes: [{ type: 'streamable-http', url }],
    tools: [{ name: 'roll_dice' }],
    serverInfo: { name: 'Demo', version: '1.0.0' },
    transport: { type: 'streamable-http', endpoint: url },
    capabilities: { tools: {} },
  };
}

const serverCard = card('/mcp', 'demo');

/** A single-mount plan: the root card only, no named slots. */
const singlePlan: McpServerCardPlan = {
  multi: false,
  cards: [{ card: serverCard, mountPathname: '/mcp', serverName: 'mcp', primary: true }],
};

/** A two-mount plan: root card for the primary plus a named slot per server. */
const multiPlan: McpServerCardPlan = {
  multi: true,
  cards: [
    {
      card: card('/api/public/mcp', 'api-public-mcp'),
      mountPathname: '/api/public/mcp',
      serverName: 'api-public-mcp',
      primary: true,
    },
    {
      card: card('/api/mcp', 'api-mcp'),
      mountPathname: '/api/mcp',
      serverName: 'api-mcp',
      primary: false,
    },
  ],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-write-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeCatalog', () => {
  it('writes a valid catalog to public/.well-known/ai-catalog.json', () => {
    const result = writeCatalog(dir, validCatalog);

    if (!result.ok) throw new Error('expected a successful write');
    expect(result.path).toBe(join(dir, CATALOG_OUTPUT_PATH));
    const written = JSON.parse(readFileSync(result.path, 'utf8'));
    expect(written).toEqual(validCatalog);
  });

  it('creates public/.well-known/ when it does not exist', () => {
    expect(existsSync(join(dir, 'public'))).toBe(false);
    writeCatalog(dir, validCatalog);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
  });

  it('never writes a file for an invalid catalog (hard-fail gate)', () => {
    const invalid = { entries: [] } as unknown as AiCatalog; // missing specVersion
    const result = writeCatalog(dir, invalid);

    if (result.ok) throw new Error('expected validation to fail');
    expect(result.errors).toBeTruthy();
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('gates on the strict ARD schema, not just the permissive base one', () => {
    // Base-valid but ARD-invalid: the identifier is not urn:air and displayName is missing.
    const ardInvalid: AiCatalog = {
      specVersion: '1.0',
      host: { displayName: 'Demo' },
      entries: [{ identifier: 'urn:x', type: 'application/json', url: 'https://x.dev' }],
    };
    const result = writeCatalog(dir, ardInvalid);

    if (result.ok) throw new Error('expected the ARD gate to fail');
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('leaves no temp file behind on a successful write', () => {
    writeCatalog(dir, validCatalog);
    const files = readdirSync(join(dir, 'public', '.well-known'));
    expect(files).toEqual(['ai-catalog.json']);
  });

  it('overwrites a previously written catalog', () => {
    writeCatalog(dir, validCatalog);
    const updated: AiCatalog = { ...validCatalog, host: { displayName: 'Updated' } };
    const result = writeCatalog(dir, updated);

    if (!result.ok) throw new Error('expected a successful write');
    const written = JSON.parse(readFileSync(result.path, 'utf8'));
    expect(written.host.displayName).toBe('Updated');
  });

  it("defaults to the 'static' target", () => {
    const result = writeCatalog(dir, validCatalog);
    if (!result.ok) throw new Error('expected a successful write');
    expect(result.target).toBe('static');
  });
});

describe("writeCatalog — 'route' emission target", () => {
  it('writes a route handler at app/.well-known/ai-catalog.json/route.ts embedding the catalog', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');

    const result = writeCatalog(dir, validCatalog, { target: 'route' });

    if (!result.ok) throw new Error('expected a successful write');
    expect(result.target).toBe('route');
    const expectedPath = join(dir, 'app', '.well-known', 'ai-catalog.json', 'route.ts');
    expect(result.path).toBe(expectedPath);

    const source = readFileSync(expectedPath, 'utf8');
    expect(source).toContain("export const dynamic = 'force-static'");
    expect(source).toContain('export function GET(): Response {');
    // The embedded body round-trips back to the exact catalog.
    const bodyLiteral = /const body = (".*");/s.exec(source)?.[1];
    if (bodyLiteral === undefined) throw new Error('expected an embedded body literal');
    expect(JSON.parse(JSON.parse(bodyLiteral))).toEqual(validCatalog);
    // The static file was NOT written when targeting the route.
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('writes route.js (no type annotation) when there is no tsconfig.json', () => {
    mkdirSync(join(dir, 'src', 'app'), { recursive: true });

    const result = writeCatalog(dir, validCatalog, { target: 'route' });

    if (!result.ok) throw new Error('expected a successful write');
    const expectedPath = join(dir, 'src', 'app', '.well-known', 'ai-catalog.json', 'route.js');
    expect(result.path).toBe(expectedPath);
    const source = readFileSync(expectedPath, 'utf8');
    expect(source).toContain('export function GET() {');
    expect(source).not.toContain(': Response');
  });

  it('falls back to the static target (with a warning) when there is no app/ directory', () => {
    const warnings: string[] = [];
    const result = writeCatalog(dir, validCatalog, {
      target: 'route',
      warn: (m) => warnings.push(m),
    });

    if (!result.ok) throw new Error('expected a successful write');
    expect(result.target).toBe('static');
    expect(result.path).toBe(join(dir, CATALOG_OUTPUT_PATH));
    expect(warnings.some((w) => w.includes('no App Router directory'))).toBe(true);
  });

  it('still refuses to write an invalid catalog to the route target', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    const invalid = { entries: [] } as unknown as AiCatalog; // missing specVersion

    const result = writeCatalog(dir, invalid, { target: 'route' });

    if (result.ok) throw new Error('expected validation to fail');
    expect(existsSync(join(dir, 'app', '.well-known'))).toBe(false);
  });
});

describe('writeServerCards', () => {
  it('writes the static card to public/.well-known/mcp/server-card.json', () => {
    const result = writeServerCards(dir, singlePlan);
    expect(result.target).toBe('static');
    expect(result.rootPath).toBe(join(dir, SERVER_CARD_OUTPUT_PATH));
    expect(result.named).toEqual([]);
    const written = JSON.parse(readFileSync(result.rootPath, 'utf8'));
    expect(written).toEqual(serverCard);
  });

  it('leaves no temp file behind on a successful static write', () => {
    writeServerCards(dir, singlePlan);
    const files = readdirSync(join(dir, 'public', '.well-known', 'mcp'));
    expect(files).toEqual(['server-card.json']);
  });

  it("writes a route handler serving application/mcp-server-card+json on target 'route'", () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');

    const result = writeServerCards(dir, singlePlan, { target: 'route' });

    expect(result.target).toBe('route');
    const expectedPath = join(dir, 'app', '.well-known', 'mcp', 'server-card.json', 'route.ts');
    expect(result.rootPath).toBe(expectedPath);

    const source = readFileSync(expectedPath, 'utf8');
    expect(source).toContain("export const dynamic = 'force-static'");
    expect(source).toContain('application/mcp-server-card+json; charset=utf-8');
    const bodyLiteral = /const body = (".*");/s.exec(source)?.[1];
    if (bodyLiteral === undefined) throw new Error('expected an embedded body literal');
    expect(JSON.parse(JSON.parse(bodyLiteral))).toEqual(serverCard);
    // The static card was NOT written when targeting the route.
    expect(existsSync(join(dir, SERVER_CARD_OUTPUT_PATH))).toBe(false);
  });

  it('falls back to the static target (with a warning) when there is no app/ directory', () => {
    const warnings: string[] = [];
    const result = writeServerCards(dir, singlePlan, {
      target: 'route',
      warn: (m) => warnings.push(m),
    });
    expect(result.target).toBe('static');
    expect(result.rootPath).toBe(join(dir, SERVER_CARD_OUTPUT_PATH));
    expect(warnings.some((w) => w.includes('no App Router directory'))).toBe(true);
  });

  it('writes the primary card at the root path AND a named card per server for a multi plan', () => {
    const result = writeServerCards(dir, multiPlan);

    const root = JSON.parse(readFileSync(join(dir, SERVER_CARD_OUTPUT_PATH), 'utf8'));
    expect(root.serverUrl).toBe('https://example.com/api/public/mcp');

    expect(result.named.map((n) => n.serverName)).toEqual(['api-public-mcp', 'api-mcp']);
    const namedDir = join(dir, SERVER_CARD_DIR_OUTPUT_PATH);
    expect(readdirSync(namedDir).sort()).toEqual(['api-mcp.json', 'api-public-mcp.json']);
    const gatedCard = JSON.parse(readFileSync(join(namedDir, 'api-mcp.json'), 'utf8'));
    expect(gatedCard.serverUrl).toBe('https://example.com/api/mcp');
  });

  it('removes stale named cards whose server is no longer in the plan', () => {
    writeServerCards(dir, multiPlan);
    const shrunk: McpServerCardPlan = {
      multi: true,
      cards: multiPlan.cards.filter((c) => c.serverName !== 'api-mcp'),
    };

    const result = writeServerCards(dir, shrunk);

    expect(result.removed).toHaveLength(1);
    expect(readdirSync(join(dir, SERVER_CARD_DIR_OUTPUT_PATH))).toEqual(['api-public-mcp.json']);
  });

  it('removes the whole named-card directory when the plan shrinks to a single mount', () => {
    writeServerCards(dir, multiPlan);

    writeServerCards(dir, singlePlan);

    expect(existsSync(join(dir, SERVER_CARD_DIR_OUTPUT_PATH))).toBe(false);
    expect(existsSync(join(dir, SERVER_CARD_OUTPUT_PATH))).toBe(true);
  });

  it("writes named route handlers under app/.well-known/mcp/server-card/ on target 'route'", () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');

    const result = writeServerCards(dir, multiPlan, { target: 'route' });

    expect(result.target).toBe('route');
    const namedHandler = join(
      dir,
      'app',
      '.well-known',
      'mcp',
      'server-card',
      'api-mcp.json',
      'route.ts',
    );
    expect(existsSync(namedHandler)).toBe(true);
    expect(result.named.map((n) => n.path)).toContain(namedHandler);
  });
});
