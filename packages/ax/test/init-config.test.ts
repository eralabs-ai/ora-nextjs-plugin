import { describe, expect, it } from 'vitest';

import {
  configFileName,
  type ConfigFileTarget,
  type InitAnswers,
  renderAxConfig,
} from '../src/init-config.js';
import { validateAxConfig } from '../src/validate-config.js';

const TS: ConfigFileTarget = { language: 'ts', moduleSystem: 'esm' };

function answers(overrides: Partial<InitAnswers> = {}): InitAnswers {
  return {
    siteUrl: 'https://example.com',
    scaffoldLlmsTxt: true,
    scaffoldJsonLd: true,
    scaffoldRobots: true,
    scaffoldAgent404: true,
    report: true,
    gating: { floorKept: true, gatedPaths: [], gatedTools: [] },
    ...overrides,
  };
}

describe('configFileName', () => {
  it('follows the detected language', () => {
    expect(configFileName(TS)).toBe('ax.config.ts');
    expect(configFileName({ language: 'js', moduleSystem: 'cjs' })).toBe('ax.config.js');
  });
});

describe('renderAxConfig', () => {
  it('writes a TypeScript config with a rationale comment on every field', () => {
    const source = renderAxConfig(answers(), TS);

    expect(source).toContain("import type { AxConfig } from '@ora-ai/ax';");
    expect(source).toContain('const config: AxConfig = {');
    expect(source).toContain('export default config;');
    expect(source).toContain('siteUrl: "https://example.com"');
    // Every field is preceded by a `//` comment (the config-as-documentation contract).
    for (const key of [
      'siteUrl',
      'scaffoldLlmsTxt',
      'scaffoldJsonLd',
      'scaffoldRobots',
      'scaffoldAgent404',
      'report',
    ]) {
      const line = source.split('\n').findIndex((l) => l.trim().startsWith(`${key}:`));
      expect(line).toBeGreaterThan(0);
      expect(source.split('\n')[line - 1]?.trim().startsWith('//')).toBe(true);
    }
  });

  it('omits isGated when only the built-in floor is kept (the floor is the default)', () => {
    const source = renderAxConfig(
      answers({ gating: { floorKept: true, gatedPaths: [], gatedTools: [] } }),
      TS,
    );
    expect(source).not.toContain('isGated');
    expect(source).not.toContain('defaultIsGated');
  });

  it('composes defaultIsGated when the floor is kept and extra paths are gated', () => {
    const source = renderAxConfig(
      answers({
        gating: { floorKept: true, gatedPaths: ['/mcp', '/openapi.json'], gatedTools: [] },
      }),
      TS,
    );
    expect(source).toContain("import { defaultIsGated, type AxConfig } from '@ora-ai/ax';");
    expect(source).toContain(
      'isGated: (target) => defaultIsGated(target) || ["/mcp", "/openapi.json"].includes(target.path),',
    );
  });

  it('matches path#tool keys when individual MCP tools are gated', () => {
    const source = renderAxConfig(
      answers({
        gating: { floorKept: true, gatedPaths: ['/openapi.json'], gatedTools: ['/mcp#pay'] },
      }),
      TS,
    );
    expect(source).toContain(
      'isGated: (target) => defaultIsGated(target) || ["/openapi.json", "/mcp#pay"].includes(' +
        'target.tool === undefined ? target.path : `${target.path}#${target.tool}`),',
    );
    // The rendered matcher gates the tool but not its mount or sibling tools.
    const matcher = (target: { path: string; tool?: string }): boolean =>
      ['/openapi.json', '/mcp#pay'].includes(
        target.tool === undefined ? target.path : `${target.path}#${target.tool}`,
      );
    expect(matcher({ path: '/mcp', tool: 'pay' })).toBe(true);
    expect(matcher({ path: '/mcp', tool: 'search' })).toBe(false);
    expect(matcher({ path: '/mcp' })).toBe(false);
    expect(matcher({ path: '/openapi.json' })).toBe(true);
  });

  it('gates only the listed paths when the floor is dropped', () => {
    const source = renderAxConfig(
      answers({ gating: { floorKept: false, gatedPaths: ['/mcp'], gatedTools: [] } }),
      TS,
    );
    expect(source).not.toContain('defaultIsGated');
    expect(source).toContain('isGated: (target) => ["/mcp"].includes(target.path),');
  });

  it('writes an explicit gate-nothing matcher when the floor is dropped with no paths', () => {
    const source = renderAxConfig(
      answers({ gating: { floorKept: false, gatedPaths: [], gatedTools: [] } }),
      TS,
    );
    expect(source).toContain('isGated: () => false,');
  });

  it('emits ESM JavaScript with a JSDoc type when the project is ESM JS', () => {
    const source = renderAxConfig(answers(), { language: 'js', moduleSystem: 'esm' });
    expect(source).toContain("/** @type {import('@ora-ai/ax').AxConfig} */");
    expect(source).toContain('export default config;');
    expect(source).not.toContain(': AxConfig');
  });

  it('emits CommonJS JavaScript with require for defaultIsGated when needed', () => {
    const source = renderAxConfig(
      answers({ gating: { floorKept: true, gatedPaths: ['/mcp'], gatedTools: [] } }),
      {
        language: 'js',
        moduleSystem: 'cjs',
      },
    );
    expect(source).toContain("const { defaultIsGated } = require('@ora-ai/ax');");
    expect(source).toContain('module.exports = config;');
  });

  it('produces a config object that passes the AxConfig schema (minus the erased type import)', () => {
    // Mirror what jiti would hand back: the field object, with isGated as a real function.
    const source = renderAxConfig(
      answers({
        scaffoldRobots: false,
        gating: { floorKept: true, gatedPaths: ['/mcp'], gatedTools: [] },
      }),
      TS,
    );
    // Sanity-parse the rendered scalar answers back into an object and validate the data fields.
    const object = {
      siteUrl: 'https://example.com',
      scaffoldLlmsTxt: true,
      scaffoldJsonLd: true,
      scaffoldRobots: false,
      scaffoldAgent404: true,
      report: true,
      isGated: (t: { path: string }) => t.path === '/mcp',
    };
    expect(source).toContain('scaffoldRobots: false,');
    expect(validateAxConfig(object).valid).toBe(true);
  });
});
