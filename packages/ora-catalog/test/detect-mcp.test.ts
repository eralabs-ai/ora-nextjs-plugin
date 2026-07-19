import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectMcpServers } from '../src/detect-mcp.js';

let dir: string;
let warnings: string[];
const warn = (message: string): void => {
  warnings.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-detect-mcp-'));
  warnings = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeMcpRoute(relDir: string, toolNames: string[] = ['roll_dice']): void {
  const routeDir = join(dir, 'app', relDir);
  mkdirSync(routeDir, { recursive: true });
  const toolCalls = toolNames
    .map((name) => `server.tool('${name}', 'desc', {}, async () => ({}));`)
    .join('\n');
  writeFileSync(
    join(routeDir, 'route.ts'),
    `import { createMcpHandler } from 'mcp-handler';\n` +
      `const handler = createMcpHandler((server) => {\n${toolCalls}\n});\n` +
      `export { handler as GET, handler as POST };\n`,
    'utf8',
  );
}

describe('detectMcpServers', () => {
  it('returns nothing when there is no app/ directory', () => {
    expect(
      detectMcpServers({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn }),
    ).toEqual([]);
  });

  it('returns nothing when app/ has no mcp-handler usage', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(
      join(dir, 'app', 'route.ts'),
      'export function GET() { return new Response("ok"); }\n',
      'utf8',
    );
    expect(
      detectMcpServers({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn }),
    ).toEqual([]);
  });

  it('does not match a file that only imports mcp-handler without mounting a handler', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(
      join(dir, 'app', 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\nexport function GET() { return new Response(String(createMcpHandler)); }\n`,
      'utf8',
    );
    // No createMcpHandler(...) call — just a reference — so this must not be treated as a mount.
    const result = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(result).toEqual([]);
  });

  it('detects a [transport] mount and resolves it to /mcp (mcp-handler default endpoint)', () => {
    writeMcpRoute('[transport]');

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      identifier: 'urn:ora-catalog:mcp-server',
      type: 'application/mcp-server-card+json',
      url: 'https://example.com/mcp',
      capabilities: ['roll_dice'],
    });
    expect(typeof entries[0]?.updatedAt).toBe('string');
  });

  it('detects a static (non-dynamic) mount path literally', () => {
    writeMcpRoute(join('api', 'mcp'));

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries[0]?.url).toBe('https://example.com/api/mcp');
  });

  it('respects basePath when building the URL', () => {
    writeMcpRoute('[transport]');

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '/app',
      warn,
    });
    expect(entries[0]?.url).toBe('https://example.com/app/mcp');
  });

  it('also detects the legacy @vercel/mcp-adapter alias', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from '@vercel/mcp-adapter';\n` +
        `const handler = createMcpHandler((server) => {});\n` +
        `export { handler as GET };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries).toHaveLength(1);
  });

  it('strips route groups from the resolved path', () => {
    writeMcpRoute(join('(internal)', 'api', 'mcp'));

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries[0]?.url).toBe('https://example.com/api/mcp');
  });

  it('skips an ambiguous dynamic segment other than [transport], with a warning', () => {
    writeMcpRoute(join('api', '[id]'));

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries).toEqual([]);
    expect(warnings.some((w) => w.includes('resolve a stable URL'))).toBe(true);
  });

  it('skips emitting an entry (with a warning) when no siteUrl is known', () => {
    writeMcpRoute('[transport]');

    const entries = detectMcpServers({ cwd: dir, siteUrl: undefined, basePath: '', warn });
    expect(entries).toEqual([]);
    expect(warnings.some((w) => w.includes('no site URL is known'))).toBe(true);
  });

  it('omits capabilities when no .tool( calls are found', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => {});\n` +
        `export { handler as GET };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries[0]).not.toHaveProperty('capabilities');
  });

  it('finds an app dir nested under src/', () => {
    const routeDir = join(dir, 'src', 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => {});\n` +
        `export { handler as GET };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries).toHaveLength(1);
  });
});
