import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildMiddlewareWiringInstruction,
  detectMiddleware,
  MIDDLEWARE_MATCHER_LITERAL,
} from '../src/middleware-wiring.js';
import { buildRouterModel } from '../src/router-model.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-middleware-wiring-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
  writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'page.tsx'), 'export default () => null;\n', 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const WIRED_SOURCE =
  "import { withAx } from '@ora-ai/ax-nextjs/middleware';\n" +
  "import { axManifest } from './ax-manifest';\n" +
  'export default withAx({ manifest: axManifest });\n';

describe('detectMiddleware', () => {
  it('reports absence', () => {
    expect(detectMiddleware(dir)).toEqual({ present: false, wiredToAx: false });
  });

  it('detects a wired middleware at the project root', () => {
    writeFileSync(join(dir, 'middleware.ts'), WIRED_SOURCE, 'utf8');
    expect(detectMiddleware(dir)).toEqual({
      present: true,
      wiredToAx: true,
      source: 'middleware.ts',
    });
  });

  it('detects an unwired middleware under src/', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'middleware.js'), 'export default () => undefined;\n', 'utf8');
    expect(detectMiddleware(dir)).toEqual({
      present: true,
      wiredToAx: false,
      source: join('src', 'middleware.js'),
    });
  });
});

describe('buildMiddlewareWiringInstruction', () => {
  it('carries the exact wiring lines a coding agent applies verbatim', () => {
    const instruction = buildMiddlewareWiringInstruction(
      dir,
      buildRouterModel(dir),
      detectMiddleware(dir),
    );

    expect(instruction).toContain("import { withAx } from '@ora-ai/ax-nextjs/middleware';");
    expect(instruction).toContain("import { axManifest } from './ax-manifest';");
    expect(instruction).toContain('export default withAx({ manifest: axManifest });');
    expect(instruction).toContain(
      `export const config = { matcher: ${MIDDLEWARE_MATCHER_LITERAL} };`,
    );
    // No manifest module exists yet, so the instruction starts with generating one — the manifest
    // must exist before `next build` compiles the middleware that imports it.
    expect(instruction).toContain('npx ax manifest');
    expect(instruction).toContain('create middleware.ts');
  });

  it('skips the manifest step once the module exists, and targets src/ layouts correctly', () => {
    mkdirSync(join(dir, 'src', 'app'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app', 'page.tsx'), 'export default () => null;\n', 'utf8');
    rmSync(join(dir, 'app'), { recursive: true, force: true });
    writeFileSync(join(dir, 'src', 'ax-manifest.ts'), 'export const axManifest = {};\n', 'utf8');

    const instruction = buildMiddlewareWiringInstruction(
      dir,
      buildRouterModel(dir),
      detectMiddleware(dir),
    );

    expect(instruction).not.toContain('npx ax manifest');
    expect(instruction).toContain(`create ${join('src', 'middleware.ts')}`);
  });

  it('tells an existing middleware to wrap, not replace', () => {
    writeFileSync(join(dir, 'middleware.ts'), 'export default () => undefined;\n', 'utf8');

    const instruction = buildMiddlewareWiringInstruction(
      dir,
      buildRouterModel(dir),
      detectMiddleware(dir),
    );

    expect(instruction).toContain(
      'export default withAx({ manifest: axManifest }, yourExistingMiddleware);',
    );
    expect(instruction).toContain('middleware.ts');
  });

  it('the matcher literal round-trips to the same regex the runtime exports', async () => {
    const { axMatcher } = await import('../src/middleware/index.js');
    // The literal is what users paste (Next statically analyzes `config`); it must stay in lockstep
    // with the runtime's exported matcher.
    expect(MIDDLEWARE_MATCHER_LITERAL).toBe(JSON.stringify([...axMatcher]).replace(/"/g, "'"));
  });
});
