import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPUTABLE_AI_CRAWLERS, TRAINING_ONLY_CRAWLERS } from './agent-ua.js';
import { buildArtifactUrl } from './site-url.js';

// The write side of `robots.txt` (`scaffoldRobots: true`). Two jobs, both deliberately narrow:
//
//   - An existing `public/robots.txt` gets *appended to* — never rewritten. ax adds the two
//     machine-readable pointers it is uniquely placed to know (`Sitemap:` for a sitemap it actually
//     detected, `Agentmap:` for the catalog it just generated) and nothing else, in a clearly
//     marked block, only when they're missing. Running twice appends nothing the second time.
//   - No robots source at all → write `public/robots.txt` once, with the `Allow` blocks that make
//     the site reachable by reputable AI crawlers.
//
// What it will not do: touch an `app/robots.ts` route handler (that file owns the policy, and it's
// code, not data), rewrite or reorder anything already in the file, or decide on the site owner's
// behalf which crawlers to *block*. Restricting a crawler is a policy call about their content;
// the scaffold shows how, commented out, and leaves the decision with them.

/** Marks the block ax appends, so a reader (and the next run) can tell what came from here. */
const APPEND_MARKER = '# Added by @ora-ai/ax';

export type RobotsScaffoldAction = 'created' | 'appended' | 'unchanged' | 'skipped';

export interface RobotsScaffoldResult {
  action: RobotsScaffoldAction;
  /** The file created or appended to, when one was touched (absolute path). */
  path?: string;
  /** Directives added on this run. Empty on every later run — appending is idempotent. */
  addedLines?: string[];
  /** Why nothing was written, for `unchanged` and `skipped`. */
  reason?: string;
}

export interface ScaffoldRobotsOptions {
  cwd: string;
  /**
   * The robots source `detectRobots` found (absolute path), if any. A path other than
   * `public/robots.txt` means an App Router `robots.*` route handler owns the policy.
   */
  existingSource?: string;
  /** Resolved site origin. Without it neither pointer can be an absolute URL, so neither is written. */
  siteUrl?: string;
  /** `next.config` `basePath`, or `''` — the pointers are served under it like everything else. */
  basePath: string;
  /** Whether a sitemap actually exists. No `Sitemap:` line is ever written for one that doesn't. */
  sitemapFound: boolean;
  warn: (message: string) => void;
}

/**
 * Appends the missing discovery pointers to an existing `public/robots.txt`, or scaffolds one when
 * the project has no robots source at all. Never overwrites, never edits an existing line, and
 * never fails the build — any filesystem error warns and returns `skipped`.
 */
export function scaffoldRobots(options: ScaffoldRobotsOptions): RobotsScaffoldResult {
  const staticPath = join(options.cwd, 'public', 'robots.txt');

  if (options.existingSource !== undefined && options.existingSource !== staticPath) {
    // The developer opted into scaffoldRobots and is getting nothing — say why, rather than
    // leaving them to wonder whether the flag took effect.
    options.warn(
      `scaffoldRobots is on, but ${options.existingSource} owns this site's robots policy — ax ` +
        "never edits a route handler. Next's MetadataRoute.Robots has no field for the " +
        '"Agentmap:" catalog pointer either, so move the policy to a static public/robots.txt if ' +
        'you want ax to maintain the discovery pointers for you.',
    );
    return {
      action: 'skipped',
      path: options.existingSource,
      reason:
        'an App Router robots route handler owns this site’s robots policy — ax never edits ' +
        'it. Next’s MetadataRoute.Robots has no field for the "Agentmap:" catalog pointer, so ' +
        'add that line in a static public/robots.txt (the two can coexist only if you move the ' +
        'policy there).',
    };
  }

  const pointers = discoveryPointers(options);

  if (existsSync(staticPath)) {
    return appendMissingPointers(staticPath, pointers, options.warn);
  }
  return createRobots(staticPath, pointers, options.warn);
}

/** The `Sitemap:` / `Agentmap:` lines this build can honestly write, in file order. */
function discoveryPointers(options: ScaffoldRobotsOptions): string[] {
  const { siteUrl, basePath } = options;
  if (siteUrl === undefined) return [];

  const lines: string[] = [];
  if (options.sitemapFound) {
    lines.push(`Sitemap: ${buildArtifactUrl(siteUrl, basePath, '/sitemap.xml')}`);
  }
  lines.push(`Agentmap: ${buildArtifactUrl(siteUrl, basePath, '/.well-known/ai-catalog.json')}`);
  return lines;
}

/**
 * Appends whichever pointers the file doesn't already declare. A directive already present anywhere
 * in the file — in any casing, ours or hand-written — counts as declared, so a second run (and a
 * run after the developer wrote the line themselves) adds nothing.
 */
function appendMissingPointers(
  path: string,
  pointers: string[],
  warn: (message: string) => void,
): RobotsScaffoldResult {
  let current: string;
  try {
    current = readFileSync(path, 'utf8');
  } catch (err) {
    warn(
      `Tried to read ${path} to add discovery pointers but couldn't (${(err as Error).message}).`,
    );
    return { action: 'skipped', path, reason: 'the existing robots.txt could not be read' };
  }

  const missing = pointers.filter((line) => !declaresDirective(current, directiveName(line)));
  if (missing.length === 0) {
    return {
      action: 'unchanged',
      path,
      reason:
        pointers.length === 0
          ? 'no site URL resolved, so neither a Sitemap: nor an Agentmap: line could be written as ' +
            'an absolute URL'
          : 'it already declares every discovery pointer ax would add',
    };
  }

  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  const block = `${separator}\n${APPEND_MARKER} — machine-readable discovery pointers for agents.\n${missing.join('\n')}\n`;

  try {
    appendFileSync(path, block, 'utf8');
  } catch (err) {
    warn(`Tried to add discovery pointers to ${path} but couldn't (${(err as Error).message}).`);
    return { action: 'skipped', path, reason: 'the existing robots.txt could not be appended to' };
  }

  warn(
    `Added ${missing.map(directiveName).join(' and ')} to ${path} (in a block marked ` +
      `"${APPEND_MARKER}") — nothing already in the file was changed.`,
  );
  return { action: 'appended', path, addedLines: missing };
}

/** Writes `public/robots.txt` once. Callers only reach here when no robots source exists. */
function createRobots(
  path: string,
  pointers: string[],
  warn: (message: string) => void,
): RobotsScaffoldResult {
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, robotsSource(pointers), 'utf8');
  } catch (err) {
    warn(`Tried to scaffold a robots.txt at ${path} but couldn't (${(err as Error).message}).`);
    return { action: 'skipped', path, reason: 'the file could not be written' };
  }

  warn(
    `Scaffolded a robots.txt at ${path} — it's yours to edit; ax never overwrites it and only ever ` +
      'appends a missing Sitemap:/Agentmap: line. Review the Allow rules (and the commented-out ' +
      'block showing how to restrict training-only crawlers) before deploying.',
  );
  return { action: 'created', path, ...(pointers.length > 0 ? { addedLines: pointers } : {}) };
}

/** The generated file. Everything in it is either factual or explicitly the developer's decision. */
function robotsSource(pointers: string[]): string {
  const allowBlocks = REPUTABLE_AI_CRAWLERS.map((agent) => `User-agent: ${agent}\nAllow: /`).join(
    '\n\n',
  );
  const restrictExample = TRAINING_ONLY_CRAWLERS.map(
    (agent) => `# User-agent: ${agent}\n# Disallow: /`,
  ).join('\n#\n');

  const pointerBlock =
    pointers.length > 0
      ? `${pointers.join('\n')}\n`
      : '# No Sitemap:/Agentmap: line yet: ax could not resolve this site’s production URL at\n' +
        '# build time, and these pointers have to be absolute URLs. Set siteUrl in ax.config (or a\n' +
        '# SITE_URL env var) and re-run — ax appends the missing lines to this file.\n';

  return `# robots.txt — scaffolded by @ora-ai/ax. This file is yours: edit it freely. ax never
# overwrites it; on later builds it only appends a missing "Sitemap:" or "Agentmap:" line, in a
# block marked "${APPEND_MARKER}".

User-agent: *
Allow: /

# Reputable AI agents and their crawlers, allowed explicitly. The wildcard above already permits
# them, but naming each one states the policy rather than leaving it implied — which is what
# agent-readiness scanners (and the agents themselves) look for.
${allowBlocks}

# Crawlers that collect content for model training rather than to answer a user's question.
# Whether to restrict them is a decision about your content, and ax will not make it for you —
# uncomment to opt out.
${restrictExample}

${pointerBlock}`;
}

/** The directive name of a `Name: value` line (`Sitemap: https://…` -> `Sitemap`). */
function directiveName(line: string): string {
  return line.slice(0, line.indexOf(':'));
}

/** Whether the file already declares a directive, in any casing and anywhere in the file. */
function declaresDirective(contents: string, name: string): boolean {
  return new RegExp(`^[ \\t]*${name}[ \\t]*:`, 'im').test(contents);
}
