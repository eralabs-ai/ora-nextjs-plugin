import { createJiti } from 'jiti';

import { DEFAULT_DENYLIST, type ArdConfig, type ResolvedArdConfig } from './config-schema.js';
import { findConfigFile } from './find-config-file.js';
import { formatConfigErrors, validateArdConfig } from './validate-config.js';

/**
 * Thrown for a present-but-invalid `ard.config.*` — the CLI's "fail loudly" gate: build-time
 * validation fails loudly with actionable messages on invalid config. Deliberately a distinct
 * type so `runCli` can report it without a stack trace, the same way it already handles bad CLI
 * args.
 */
export class ArdConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArdConfigError';
  }
}

export interface LoadArdConfigResult {
  config: ResolvedArdConfig;
  /** Absolute path of the config file that was loaded, or undefined when none was found. */
  path?: string;
}

/**
 * Finds and loads `ard.config.{ts,mts,cts,mjs,js,cjs}` from `cwd`, validates it against this
 * package's own schema, and returns it with every optional field defaulted.
 *
 * A missing file is a normal, silent case (defaults apply, nothing to warn about). A file that
 * exists but fails to evaluate, or evaluates to something that doesn't match the schema, throws
 * `ArdConfigError` — unlike `next-config.ts`'s warn-and-fall-back, this is the plugin's own config
 * surface, so an invalid one is this plugin's bug to report loudly, not paper over.
 */
export async function loadArdConfig(cwd: string): Promise<LoadArdConfigResult> {
  const path = findConfigFile(cwd, 'ard.config');
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
    throw new ArdConfigError(`Failed to load ${path}:\n  ${(err as Error).message}`);
  }

  const result = validateArdConfig(raw);
  if (!result.valid) {
    throw new ArdConfigError(`${path} is invalid:\n${formatConfigErrors(result.errors)}`);
  }

  return { config: withDefaults(raw as ArdConfig), path };
}

function withDefaults(config: ArdConfig): ResolvedArdConfig {
  return {
    siteUrl: config.siteUrl,
    emit: config.emit ?? 'static',
    scaffoldLlmsTxt: config.scaffoldLlmsTxt ?? false,
    scaffoldAgent404: config.scaffoldAgent404 ?? false,
    denylist: config.denylist ?? [...DEFAULT_DENYLIST],
    allowlist: config.allowlist ?? [],
    report: config.report ?? false,
    entries: config.entries ?? [],
  };
}
