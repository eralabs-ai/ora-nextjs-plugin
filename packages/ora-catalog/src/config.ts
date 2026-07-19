import { createJiti } from 'jiti';

import {
  DEFAULT_DENYLIST,
  type OraCatalogConfig,
  type ResolvedOraCatalogConfig,
} from './config-schema.js';
import { findConfigFile } from './find-config-file.js';
import { formatConfigErrors, validateOraCatalogConfig } from './validate-config.js';

/**
 * Thrown for a present-but-invalid `ora-catalog.config.*` — the CLI's "fail loudly" gate
 * (PLAN.md 2.1: "Build-time validation fails loudly with actionable messages on invalid
 * config."). Deliberately a distinct type so `runCli` can report it without a stack trace, the
 * same way it already handles bad CLI args.
 */
export class OraCatalogConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OraCatalogConfigError';
  }
}

export interface LoadOraCatalogConfigResult {
  config: ResolvedOraCatalogConfig;
  /** Absolute path of the config file that was loaded, or undefined when none was found. */
  path?: string;
}

/**
 * Finds and loads `ora-catalog.config.{ts,mts,cts,mjs,js,cjs}` from `cwd`, validates it against
 * this package's own schema, and returns it with every optional field defaulted.
 *
 * A missing file is a normal, silent case (defaults apply, nothing to warn about). A file that
 * exists but fails to evaluate, or evaluates to something that doesn't match the schema, throws
 * `OraCatalogConfigError` — unlike `next-config.ts`'s warn-and-fall-back, this is the plugin's own
 * config surface, so an invalid one is this plugin's bug to report loudly, not paper over.
 */
export async function loadOraCatalogConfig(cwd: string): Promise<LoadOraCatalogConfigResult> {
  const path = findConfigFile(cwd, 'ora-catalog.config');
  if (!path) {
    return { config: withDefaults({}) };
  }

  let raw: unknown;
  try {
    // fsCache/moduleCache disabled: this loads a tiny file once per build (or once per test) —
    // correctness (always reflecting the current file contents) matters far more than the
    // transpile-cache speedup here.
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      moduleCache: false,
      fsCache: false,
    });
    raw = await jiti.import(path, { default: true });
  } catch (err) {
    throw new OraCatalogConfigError(`Failed to load ${path}:\n  ${(err as Error).message}`);
  }

  const result = validateOraCatalogConfig(raw);
  if (!result.valid) {
    throw new OraCatalogConfigError(`${path} is invalid:\n${formatConfigErrors(result.errors)}`);
  }

  return { config: withDefaults(raw as OraCatalogConfig), path };
}

function withDefaults(config: OraCatalogConfig): ResolvedOraCatalogConfig {
  return {
    denylist: config.denylist ?? [...DEFAULT_DENYLIST],
    allowlist: config.allowlist ?? [],
    entries: config.entries ?? [],
  };
}
