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

describe('renderAxConfig entries (declared auth from the wizard)', () => {
  const authEntries: InitAnswers['entries'] = [
    {
      identifier: 'urn:air:example.com:mcp-server',
      auth: {
        status: 'oauth2',
        oauth: {
          authorizationEndpoint: 'https://auth.example.com/authorize',
          tokenEndpoint: 'https://auth.example.com/token',
        },
        docsUrl: 'https://example.com/docs/auth',
      },
    },
  ];

  it('omits the entries key entirely when the wizard collected none', () => {
    expect(renderAxConfig(answers(), TS)).not.toContain('entries:');
  });

  it('renders collected auth entries as readable object literals, not quoted-key JSON', () => {
    const source = renderAxConfig(answers({ entries: authEntries }), TS);
    expect(source).toContain('entries: [');
    expect(source).toContain('identifier: "urn:air:example.com:mcp-server"');
    expect(source).toContain('status: "oauth2"');
    expect(source).toContain('authorizationEndpoint: "https://auth.example.com/authorize"');
    expect(source).toContain('docsUrl: "https://example.com/docs/auth"');
    expect(source).not.toContain('"identifier":');
  });

  it('renders a config that passes the ax.config schema gate (TS, ESM, and CJS forms)', async () => {
    for (const target of [
      TS,
      { language: 'js', moduleSystem: 'esm' },
      { language: 'js', moduleSystem: 'cjs' },
    ] as ConfigFileTarget[]) {
      const source = renderAxConfig(answers({ entries: authEntries }), target);
      // Evaluate the rendered body the way a config loader would see it: strip module syntax and
      // parse the object literal, then run it through the real schema gate.
      const objectSource = source
        .replace(/^import type.*$/m, '')
        .replace(/^\/\*\* @type.*$/m, '')
        .replace('const config: AxConfig =', 'const config =')
        .replace('export default config;', '')
        .replace('module.exports = config;', '');
      // eslint-disable-next-line no-new-func
      const config: unknown = new Function(`${objectSource}\nreturn config;`)();
      const result = validateAxConfig(config);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });
});
