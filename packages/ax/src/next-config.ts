import { createJiti } from 'jiti';

import { findConfigFile } from './find-config-file.js';

/** The subset of `next.config` this plugin needs. */
export interface ExtractedNextConfig {
  basePath?: string;
  distDir?: string;
  output?: string;
}

export interface LoadNextConfigResult {
  config: ExtractedNextConfig;
  /** Absolute path of the next.config file that was loaded, or undefined if none was found. */
  path?: string;
  /** Non-fatal issues to surface in build output. Loading next.config never throws. */
  warnings: string[];
}

// The literal value of `PHASE_PRODUCTION_BUILD` from `next/constants`, hardcoded rather than
// imported so this package carries no dependency on `next` (it always runs inside an app that
// already has `next` installed, but importing it here would break loading this module against
// synthetic fixtures/tests that don't).
const PRODUCTION_BUILD_PHASE = 'phase-production-build';

/**
 * Loads the user's `next.config.{ts,mts,cts,mjs,js,cjs}` and extracts `basePath`, `distDir`, and
 * `output` — so users never repeat these in `ax.config`. Handles both
 * object-form and function-form (`(phase, { defaultConfig }) => config`) configs, sync or async.
 *
 * Never throws: an app's `next.config` is not this plugin's problem to fail a build over. A
 * missing file is normal (defaults, no warning). A file that exists but fails to load or evaluate
 * warns and falls back to defaults instead.
 */
export async function loadNextConfig(cwd: string): Promise<LoadNextConfigResult> {
  const path = findConfigFile(cwd, 'next.config');
  if (!path) {
    return { config: {}, warnings: [] };
  }

  let loaded: unknown;
  try {
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      moduleCache: false,
      fsCache: false,
    });
    loaded = await jiti.import(path, { default: true });
  } catch (err) {
    return {
      config: {},
      path,
      warnings: [nextConfigWarning(path, `failed to load (${(err as Error).message})`)],
    };
  }

  let resolved: unknown;
  try {
    resolved =
      typeof loaded === 'function'
        ? await loaded(PRODUCTION_BUILD_PHASE, { defaultConfig: {} })
        : loaded;
  } catch (err) {
    return {
      config: {},
      path,
      warnings: [
        nextConfigWarning(path, `its exported function threw (${(err as Error).message})`),
      ],
    };
  }

  return { config: extract(resolved), path, warnings: [] };
}

function nextConfigWarning(path: string, reason: string): string {
  return (
    `Could not read ${path} (${reason}) — proceeding with default deployment settings ` +
    '(no basePath, distDir, or output detected).'
  );
}

function extract(value: unknown): ExtractedNextConfig {
  if (typeof value !== 'object' || value === null) return {};
  const obj = value as Record<string, unknown>;
  const config: ExtractedNextConfig = {};
  if (typeof obj.basePath === 'string') config.basePath = obj.basePath;
  if (typeof obj.distDir === 'string') config.distDir = obj.distDir;
  if (typeof obj.output === 'string') config.output = obj.output;
  return config;
}
