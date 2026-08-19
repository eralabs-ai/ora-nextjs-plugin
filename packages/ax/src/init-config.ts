// Renders the `ax.config` source `ax init` writes. The generated file is meant to be read as much
// as run: every field carries a one-line comment saying why it's there, so the config a developer
// commits doubles as the documentation for what they turned on. This module is pure — answers in,
// source string out — so the wizard's I/O and this file's exact shape can be tested apart.

/** How the config file should be written, derived from the project (never asked). */
export interface ConfigFileTarget {
  /** `.ts` when the project has a tsconfig.json, else `.js`. Drives the filename and syntax. */
  language: 'ts' | 'js';
  /**
   * Module syntax for a `.js` file: `esm` (`import`/`export default`) or `cjs`
   * (`require`/`module.exports`), taken from package.json `type`. Ignored for `.ts` (always ESM,
   * the only form tsconfig-based projects use here).
   */
  moduleSystem: 'esm' | 'cjs';
}

/**
 * Everything the wizard collected that shapes the config file. Deliberately *not* here: the MCP
 * gating answer — that decision is recorded in the server card the wizard writes
 * (`authentication.required`), which the next build reads back, so the config never needs an
 * `isGated` for it (the built-in floor still applies with no `isGated` at all).
 */
export interface InitAnswers {
  siteUrl: string;
  scaffoldLlmsTxt: boolean;
  scaffoldJsonLd: boolean;
  scaffoldRobots: boolean;
  scaffoldAgent404: boolean;
  report: boolean;
}

/** The canonical config basename (matches config.ts's `CONFIG_BASENAME`). */
export const CONFIG_BASENAME = 'ax.config';

/** The config filename to write for a given target, e.g. `ax.config.ts`. */
export function configFileName(target: ConfigFileTarget): string {
  return `${CONFIG_BASENAME}.${target.language}`;
}

/** A `key: value,` line preceded by its rationale comment, at two-space indent. */
function field(comment: string, key: string, value: string): string {
  return `  // ${comment}\n  ${key}: ${value},`;
}

/**
 * Renders the full `ax.config` source for the given answers and file target. The comments explain
 * *why* each field exists rather than what it does, so the file stays useful documentation as the
 * project grows.
 */
export function renderAxConfig(answers: InitAnswers, target: ConfigFileTarget): string {
  const fields = [
    field(
      'Your public production origin. Every detected artifact URL is resolved against it and it is ' +
        'written verbatim into the published catalog, so it must be the real domain — not localhost or a preview URL.',
      'siteUrl',
      JSON.stringify(answers.siteUrl),
    ),
    field(
      'Scaffold a starter llms.txt from your real routes and detected artifacts. Fill in its ' +
        '"When to use" section — that guidance is the one part no build tool can derive.',
      'scaffoldLlmsTxt',
      String(answers.scaffoldLlmsTxt),
    ),
    field(
      'Scaffold an Organization JSON-LD component so agents can identify this site as an entity. ' +
        'ax prints the exact import/element to add to your layout; it never edits the layout for you.',
      'scaffoldJsonLd',
      String(answers.scaffoldJsonLd),
    ),
    field(
      'Add discovery pointers (Sitemap:/Agentmap:) and reputable-AI-crawler Allow rules to ' +
        'robots.txt. An existing robots.txt is only appended to, never rewritten.',
      'scaffoldRobots',
      String(answers.scaffoldRobots),
    ),
    field(
      'Scaffold an agent-aware 404 that tells agents why a page is missing and lists your real ' +
        'routes and discovery artifacts, so a wrong URL is a signpost instead of a dead end.',
      'scaffoldAgent404',
      String(answers.scaffoldAgent404),
    ),
    field(
      'Write .ora/report.json — the machine-readable build report your coding agent reads to work ' +
        'through the remaining agent-readiness recommendations.',
      'report',
      String(answers.report),
    ),
  ];

  const body = fields.join('\n');

  if (target.language === 'ts') {
    return `import type { AxConfig } from '@ora-ai/ax';\n\nconst config: AxConfig = {\n${body}\n};\n\nexport default config;\n`;
  }

  // JavaScript: no type annotation, but keep the AxConfig JSDoc so editors still complete the shape.
  const jsdoc = "/** @type {import('@ora-ai/ax').AxConfig} */";
  if (target.moduleSystem === 'cjs') {
    return `${jsdoc}\nconst config = {\n${body}\n};\n\nmodule.exports = config;\n`;
  }
  return `${jsdoc}\nconst config = {\n${body}\n};\n\nexport default config;\n`;
}
