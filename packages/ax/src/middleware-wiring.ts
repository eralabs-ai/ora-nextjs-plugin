import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import {
  existingManifestModulePath,
  manifestModulePath,
  MANIFEST_MODULE_BASE,
} from './manifest.js';
import type { RouterModel } from './router-model.js';

// The wiring story for the runtime middleware, same rules as every scaffold-adjacent surface:
// `middleware.ts` is the user's singleton (Next.js allows exactly one), so ax NEVER writes or edits
// it — the CLI prints the exact lines to add and the report carries the same strings, identical to
// the JSON-LD wiring pattern, phrased so a coding agent can apply them verbatim.

/** The import specifier consumers wire — its presence in a middleware file means "already wired". */
export const MIDDLEWARE_ENTRY_SPECIFIER = '@ora-ai/ax-nextjs/middleware';

/**
 * The recommended `config.matcher` literal, duplicated here from the runtime entry's `axMatcher`
 * export on purpose: Next.js only accepts a statically analyzable matcher, so the instruction must
 * hand the user a literal to paste, not a reference to an import.
 */
export const MIDDLEWARE_MATCHER_LITERAL =
  "['/((?!_next|api|.*\\\\..*|favicon|robots|health|status).*)']";

/** Whether a middleware file exists (root or `src/`, Next's two allowed homes) and wires ax. */
export interface MiddlewareStatus {
  present: boolean;
  /** Whether the file imports the ax runtime entry — textual, same posture as the agent-404 check. */
  wiredToAx: boolean;
  /** The middleware source path relative to the project root, when present. */
  source?: string;
}

/** Detects the project's `middleware.{ts,js}` (project root or `src/`) and whether it wires ax. */
export function detectMiddleware(cwd: string): MiddlewareStatus {
  const candidates = [
    join(cwd, 'middleware.ts'),
    join(cwd, 'middleware.js'),
    join(cwd, 'src', 'middleware.ts'),
    join(cwd, 'src', 'middleware.js'),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (found === undefined) return { present: false, wiredToAx: false };

  let wiredToAx = false;
  try {
    wiredToAx = readFileSync(found, 'utf8').includes(MIDDLEWARE_ENTRY_SPECIFIER);
  } catch {
    // Unreadable file: report presence, leave the wiring actionable.
  }
  return { present: true, wiredToAx, source: relative(cwd, found) };
}

/**
 * The exact wiring, computed against where the serving manifest module lives (or would live) so
 * the relative import is right for this project's layout. One string, usable verbatim as a CLI
 * recommendation and as the ora-check note.
 */
export function buildMiddlewareWiringInstruction(
  cwd: string,
  router: RouterModel,
  status: MiddlewareStatus,
): string {
  const manifestPath = existingManifestModulePath(cwd) ?? manifestModulePath(cwd, router);
  const manifestExists = existsSync(manifestPath);
  const middlewareDir = relative(cwd, dirname(manifestPath)) || '.';
  const middlewareFile = join(
    middlewareDir,
    `middleware.${manifestPath.endsWith('.ts') ? 'ts' : 'js'}`,
  );

  const manifestStep = manifestExists
    ? ''
    : 'First run `npx ax manifest` (and wire it as the "prebuild" script so it stays fresh — ' +
      '`middleware.ts` is compiled during `next build`, so the manifest must exist before the ' +
      'build starts). Then: ';

  const wrapLine = status.present
    ? `wrap your existing default export: \`export default withAx({ manifest: axManifest }, yourExistingMiddleware);\` in ${status.source ?? middlewareFile}`
    : `create ${middlewareFile} with \`export default withAx({ manifest: axManifest });\``;

  return (
    'Serve agents the generated markdown automatically: ' +
    manifestStep +
    `add \`import { withAx } from '${MIDDLEWARE_ENTRY_SPECIFIER}';\` and ` +
    `\`import { axManifest } from './${MANIFEST_MODULE_BASE}';\`, ` +
    wrapLine +
    `, and export the matcher literal \`export const config = { matcher: ${MIDDLEWARE_MATCHER_LITERAL} };\`. ` +
    'The middleware rewrites a request to its markdown twin only when the manifest lists one, ' +
    'never touches gated paths, and answers unknown URLs from detected agents with a 200 ' +
    'markdown wayfinding body — it composes with (never replaces) your existing middleware.'
  );
}
