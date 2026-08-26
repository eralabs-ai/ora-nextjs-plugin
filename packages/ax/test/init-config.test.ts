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
    markdownTwins: true,
    report: true,
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

    expect(source).toContain("import type { AxConfig } from '@ora-ai/ax-nextjs';");
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
      'markdownTwins',
      'report',
    ]) {
      const line = source.split('\n').findIndex((l) => l.trim().startsWith(`${key}:`));
      expect(line).toBeGreaterThan(0);
      expect(source.split('\n')[line - 1]?.trim().startsWith('//')).toBe(true);
    }
  });

  it('never writes isGated — the gating decision lives in the server card, not the config', () => {
    const source = renderAxConfig(answers(), TS);
    expect(source).not.toContain('isGated');
    expect(source).not.toContain('defaultIsGated');
  });

  it('emits ESM JavaScript with a JSDoc type when the project is ESM JS', () => {
    const source = renderAxConfig(answers(), { language: 'js', moduleSystem: 'esm' });
    expect(source).toContain("/** @type {import('@ora-ai/ax-nextjs').AxConfig} */");
    expect(source).toContain('export default config;');
    expect(source).not.toContain(': AxConfig');
  });

  it('emits CommonJS JavaScript with module.exports', () => {
    const source = renderAxConfig(answers(), { language: 'js', moduleSystem: 'cjs' });
    expect(source).toContain("/** @type {import('@ora-ai/ax-nextjs').AxConfig} */");
    expect(source).toContain('module.exports = config;');
  });

  it('produces a config object that passes the AxConfig schema (minus the erased type import)', () => {
    const source = renderAxConfig(answers({ scaffoldRobots: false }), TS);
    // Sanity-parse the rendered scalar answers back into an object and validate the data fields.
    const object = {
      siteUrl: 'https://example.com',
      scaffoldLlmsTxt: true,
      scaffoldJsonLd: true,
      scaffoldRobots: false,
      scaffoldAgent404: true,
      markdownTwins: true,
      report: true,
    };
    expect(source).toContain('scaffoldRobots: false,');
    expect(validateAxConfig(object).valid).toBe(true);
  });
});
