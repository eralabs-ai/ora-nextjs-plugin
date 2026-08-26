import { describe, expect, it } from 'vitest';

import type { CommentedEntry } from '../src/init-config.js';
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
    expect(source).toContain("/** @type {import('@ora-ai/ax').AxConfig} */");
    expect(source).toContain('export default config;');
    expect(source).not.toContain(': AxConfig');
  });

  it('emits CommonJS JavaScript with module.exports', () => {
    const source = renderAxConfig(answers(), { language: 'js', moduleSystem: 'cjs' });
    expect(source).toContain("/** @type {import('@ora-ai/ax').AxConfig} */");
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

const DOCS_ENTRY: CommentedEntry = {
  comment: 'Docs section detected under /docs — approved during ax init',
  entry: {
    identifier: 'urn:air:example.com:docs-docs',
    type: 'text/html',
    displayName: 'Docs',
    url: 'https://example.com/docs',
    tags: ['ax:docs'],
  },
};
const SKILLS_REPO_ENTRY: CommentedEntry = {
  comment: 'External skills repository you added during ax init',
  entry: {
    identifier: 'urn:air:example.com:skills-repo',
    type: 'application/agent-skills+md',
    displayName: 'Agent skills repository',
    url: 'https://github.com/example/skills',
  },
};

describe('renderAxConfig publishSkills + entries', () => {
  it('renders publishSkills: true with a rationale comment above it', () => {
    const source = renderAxConfig(answers({ publishSkills: true }), TS);
    expect(source).toContain('publishSkills: true,');
    const line = source.split('\n').findIndex((l) => l.trim().startsWith('publishSkills:'));
    expect(source.split('\n')[line - 1]?.trim().startsWith('//')).toBe(true);
  });

  it('renders publishSkills as a string[] of forward-slashed paths', () => {
    const source = renderAxConfig(
      answers({ publishSkills: ['skills/getting-started', '.claude/skills/internal'] }),
      TS,
    );
    expect(source).toContain(
      'publishSkills: ["skills/getting-started",".claude/skills/internal"],',
    );
  });

  it('omits publishSkills entirely when the answer is undefined', () => {
    expect(renderAxConfig(answers(), TS)).not.toContain('publishSkills');
  });

  it('omits entries entirely when none were collected (empty or undefined)', () => {
    expect(renderAxConfig(answers(), TS)).not.toContain('entries:');
    expect(renderAxConfig(answers({ entries: [] }), TS)).not.toContain('entries:');
  });

  it('renders an entries array with one rationale comment per entry', () => {
    const source = renderAxConfig(answers({ entries: [DOCS_ENTRY, SKILLS_REPO_ENTRY] }), TS);
    expect(source).toContain('entries: [');
    // The field-level comment sits directly above `entries:` (the config-as-documentation contract).
    const entriesLine = source.split('\n').findIndex((l) => l.trim().startsWith('entries:'));
    expect(source.split('\n')[entriesLine - 1]?.trim().startsWith('//')).toBe(true);
    // One rationale comment per entry.
    expect(source).toContain('// Docs section detected under /docs — approved during ax init');
    expect(source).toContain('// External skills repository you added during ax init');
    // The entry objects render as literals carrying their fields.
    expect(source).toContain('"identifier": "urn:air:example.com:docs-docs"');
    expect(source).toContain('"tags": [');
    expect(source).toContain('"type": "application/agent-skills+md"');
  });

  it('emits valid entry literals in all three targets', () => {
    for (const target of [
      TS,
      { language: 'js', moduleSystem: 'esm' } as const,
      { language: 'js', moduleSystem: 'cjs' } as const,
    ]) {
      const source = renderAxConfig(
        answers({ publishSkills: true, entries: [DOCS_ENTRY] }),
        target,
      );
      expect(source).toContain('publishSkills: true,');
      expect(source).toContain('entries: [');
      expect(source).toContain('"identifier": "urn:air:example.com:docs-docs"');
    }
  });

  it('produces a config with entries + publishSkills that passes the AxConfig schema', () => {
    const object = {
      siteUrl: 'https://example.com',
      publishSkills: ['skills/getting-started'],
      entries: [DOCS_ENTRY.entry, SKILLS_REPO_ENTRY.entry],
    };
    expect(validateAxConfig(object).valid).toBe(true);
  });
});
