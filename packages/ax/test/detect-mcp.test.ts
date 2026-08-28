import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyDeclaredMountAuth, detectMcpMounts, detectMcpServers } from '../src/detect-mcp.js';

let dir: string;
let warnings: string[];
const warn = (message: string): void => {
  warnings.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-detect-mcp-'));
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
      identifier: 'urn:air:example.com:mcp-server',
      type: 'application/mcp-server-card+json',
      url: 'https://example.com/mcp',
      capabilities: ['roll_dice'],
    });
    expect(typeof entries[0]?.updatedAt).toBe('string');
  });

  it('disambiguates multiple mounts with sanitized, ARD-conformant URN segments', () => {
    writeMcpRoute('[transport]');
    writeMcpRoute(join('api', 'tools'));

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });

    expect(entries).toHaveLength(2);
    const ids = entries.map((e) => e.identifier).sort();
    // Mount pathnames contain "/" which the ARD URN pattern forbids inside a segment — they must
    // be sanitized (e.g. /api/tools -> api-tools), never embedded raw.
    expect(ids).toEqual([
      'urn:air:example.com:mcp-server:api-tools',
      'urn:air:example.com:mcp-server:mcp',
    ]);
    for (const id of ids) {
      expect(id).toMatch(/^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/);
    }
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

  it('ignores a createMcpHandler( call that only appears in a // comment', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    // A real import of the package plus a *commented-out* mount: the two-signal rule alone is
    // satisfied, so without comment scrubbing this publishes an endpoint that doesn't exist.
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `// const handler = createMcpHandler((server) => {});\n` +
        `export function GET() { return new Response(String(createMcpHandler)); }\n`,
      'utf8',
    );

    expect(
      detectMcpServers({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn }),
    ).toEqual([]);
  });

  it('ignores a createMcpHandler( call that only appears in a /* */ comment', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `/**\n * Mount it with:\n *   const handler = createMcpHandler((server) => {});\n */\n` +
        `export function GET() { return new Response(String(createMcpHandler)); }\n`,
      'utf8',
    );

    expect(
      detectMcpServers({ cwd: dir, siteUrl: 'https://example.com', basePath: '', warn }),
    ).toEqual([]);
  });

  it('does not scrape a .tool( name that only appears in a comment', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => {\n` +
        `  server.tool('real_tool', 'desc', {}, async () => ({}));\n` +
        `  // server.tool('commented_out_tool', 'desc', {}, async () => ({}));\n` +
        `  /* server.tool('block_commented_tool'); */\n` +
        `});\n` +
        `export { handler as GET };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries[0]?.capabilities).toEqual(['real_tool']);
  });

  it('does not scrape a .tool( name from inside a template literal', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `const docs = \`\n  Register tools like this:\n  server.tool('documented_tool', 'desc', {});\n\`;\n` +
        `const handler = createMcpHandler((server) => {\n` +
        `  server.tool('real_tool', 'desc', {}, async () => ({}));\n` +
        `});\n` +
        `export { handler as GET, docs };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries[0]?.capabilities).toEqual(['real_tool']);
  });

  it('still detects a real mount whose file also carries explanatory comments', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `// This route mounts an MCP server via createMcpHandler( ... ) — see mcp-handler docs.\n` +
        `import { createMcpHandler } from 'mcp-handler';\n` +
        `/* The handler below is the real mount. */\n` +
        `const handler = createMcpHandler((server) => {\n` +
        `  server.tool('roll_dice', 'desc', {}, async () => ({}));\n` +
        `});\n` +
        `export { handler as GET, handler as POST };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.capabilities).toEqual(['roll_dice']);
  });

  it('leaves a plain (un-wrapped) mount with no auth field — never infers open', () => {
    writeMcpRoute('[transport]');
    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries[0]).not.toHaveProperty('auth');
  });

  it('marks a withMcpAuth-wrapped mount gated with auth.status "unknown"', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `import { withMcpAuth } from 'mcp-handler';\n` +
        `const handler = createMcpHandler((server) => { server.tool('roll_dice', 'd', {}, async () => ({})); });\n` +
        `const authed = withMcpAuth(handler, verifyToken, { resourceMetadataPath: '/.well-known/oauth-protected-resource' });\n` +
        `export { authed as GET };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries[0]?.auth).toEqual({ status: 'unknown' });

    // The mount also carries the RFC 9728 metadata path (for the server card cross-link).
    const mounts = detectMcpMounts({ cwd: dir, warn });
    expect(mounts[0]).toMatchObject({
      auth: { status: 'unknown' },
      resourceMetadataPath: '/.well-known/oauth-protected-resource',
    });
  });

  it('does not treat a withMcpAuth mention inside a comment as gated', () => {
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `// Wrap with withMcpAuth(handler, verifyToken) if you add auth.\n` +
        `const handler = createMcpHandler((server) => { server.tool('roll_dice', 'd', {}, async () => ({})); });\n` +
        `export { handler as GET };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries[0]).not.toHaveProperty('auth');
  });

  it('does not gate a mount that merely references a verifyToken symbol (no withMcpAuth call)', () => {
    // `verifyToken` is far too common a name to gate on: an open server with a helper (or import)
    // called verifyToken must not be marked gated. Gating keys on the `withMcpAuth(` call only.
    const routeDir = join(dir, 'app', '[transport]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'route.ts'),
      `import { createMcpHandler } from 'mcp-handler';\n` +
        `function verifyToken(req) { return undefined; }\n` +
        `const handler = createMcpHandler((server) => {\n` +
        `  server.tool('roll_dice', 'd', {}, async () => ({}));\n` +
        `});\n` +
        `export { handler as GET, verifyToken };\n`,
      'utf8',
    );

    const entries = detectMcpServers({
      cwd: dir,
      siteUrl: 'https://example.com',
      basePath: '',
      warn,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty('auth');
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

describe('applyDeclaredMountAuth', () => {
  const mount = (pathname: string, auth?: import('../src/types.js').EntryAuth) => ({
    filePath: join('app', 'route.ts'),
    pathname,
    capabilities: [],
    ...(auth !== undefined ? { auth } : {}),
  });
  const declared: import('../src/types.js').EntryAuth = {
    status: 'oauth2',
    oauth: { tokenEndpoint: 'https://auth.example.com/token' },
  };

  it('routes a declared auth into the single mount via the undisambiguated identifier', () => {
    const mounts = applyDeclaredMountAuth({
      mounts: [mount('/mcp')],
      overrides: [{ identifier: 'urn:air:example.com:mcp-server', auth: declared }],
      siteUrl: 'https://example.com',
      warn,
    });
    expect(mounts[0]?.auth).toEqual(declared);
    expect(warnings).toEqual([]);
  });

  it('refines a detected withMcpAuth "unknown" into the declared descriptor', () => {
    const mounts = applyDeclaredMountAuth({
      mounts: [mount('/mcp', { status: 'unknown' })],
      overrides: [{ identifier: 'urn:air:example.com:mcp-server', auth: declared }],
      siteUrl: 'https://example.com',
      warn,
    });
    expect(mounts[0]?.auth).toEqual(declared);
  });

  it('matches multi-mount identifiers by their disambiguating path segment only', () => {
    const mounts = applyDeclaredMountAuth({
      mounts: [mount('/api/mcp'), mount('/api/other-mcp')],
      overrides: [{ identifier: 'urn:air:example.com:mcp-server:api-mcp', auth: declared }],
      siteUrl: 'https://example.com',
      warn,
    });
    expect(mounts[0]?.auth).toEqual(declared);
    expect(mounts[1]).not.toHaveProperty('auth');
  });

  it('warns and ignores a declared status "none" — a declaration cannot assert a mount open', () => {
    const detected: import('../src/types.js').EntryAuth = { status: 'unknown' };
    const mounts = applyDeclaredMountAuth({
      mounts: [mount('/mcp', detected)],
      overrides: [{ identifier: 'urn:air:example.com:mcp-server', auth: { status: 'none' } }],
      siteUrl: 'https://example.com',
      warn,
    });
    expect(mounts[0]?.auth).toEqual(detected);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"none"');
  });

  it('changes nothing without a site URL (identifiers cannot be computed)', () => {
    const mounts = applyDeclaredMountAuth({
      mounts: [mount('/mcp')],
      overrides: [{ identifier: 'urn:air:example.com:mcp-server', auth: declared }],
      siteUrl: undefined,
      warn,
    });
    expect(mounts[0]).not.toHaveProperty('auth');
    expect(warnings).toEqual([]);
  });
});
