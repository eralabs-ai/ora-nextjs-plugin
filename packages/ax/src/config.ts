import { basename } from 'node:path';

import { createJiti } from 'jiti';

import type { AxConfig, ResolvedAxConfig } from './config-schema.js';
import { findConfigFile } from './find-config-file.js';
import { formatConfigErrors, validateAxConfig } from './validate-config.js';

/** Canonical config basename, named after the `ax` CLI this package ships. */
const CONFIG_BASENAME = 'ax.config';

/** Pre-rename basename, still honoured (with a warning) so existing projects keep building. */
const LEGACY_CONFIG_BASENAME = 'ard.config';

/**
 * Thrown for a present-but-invalid `ax.config.*` — the CLI's "fail loudly" gate: build-time
 * validation fails loudly with actionable messages on invalid config. Deliberately a distinct
 * type so `runCli` can report it without a stack trace, the same way it already handles bad CLI
 * args.
 */
export class AxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AxConfigError';
  }
}

/** @deprecated Renamed to {@link AxConfigError} along with `ard.config.*` → `ax.config.*`. */
export const ArdConfigError = AxConfigError;
/** @deprecated Renamed to {@link AxConfigError} along with `ard.config.*` → `ax.config.*`. */
export type ArdConfigError = AxConfigError;

export interface LoadAxConfigResult {
  config: ResolvedAxConfig;
  /** Absolute path of the config file that was loaded, or undefined when none was found. */
  path?: string;
  /**
   * Non-fatal notices about *which* file was picked — a legacy `ard.config.*` being used, or an
   * `ard.config.*` being ignored because an `ax.config.*` also exists. Empty in the normal case.
   * Returned rather than printed so the caller decides how (and whether) to surface them.
   */
  warnings: string[];
}

/** @deprecated Renamed to {@link LoadAxConfigResult} along with `ard.config.*` → `ax.config.*`. */
export type LoadArdConfigResult = LoadAxConfigResult;

/**
 * Finds and loads `ax.config.{ts,mts,cts,mjs,js,cjs}` from `cwd`, validates it against this
 * package's own schema, and returns it with every optional field defaulted.
 *
 * A missing file is a normal, silent case (defaults apply, nothing to warn about). A file that
 * exists but fails to evaluate, or evaluates to something that doesn't match the schema, throws
 * `AxConfigError` — unlike `next-config.ts`'s warn-and-fall-back, this is the plugin's own config
 * surface, so an invalid one is this plugin's bug to report loudly, not paper over.
 *
 * The pre-rename `ard.config.*` is still loaded when no `ax.config.*` exists, with a deprecation
 * warning; when both exist the `ax.config.*` wins and the legacy file is ignored (also warned).
 */
export async function loadAxConfig(cwd: string): Promise<LoadAxConfigResult> {
  const warnings: string[] = [];
  const configPath = findConfigFile(cwd, CONFIG_BASENAME);
  const legacyPath = findConfigFile(cwd, LEGACY_CONFIG_BASENAME);

  if (configPath && legacyPath) {
    warnings.push(
      `both ${basename(configPath)} and ${basename(legacyPath)} exist — using ` +
        `${basename(configPath)} and ignoring ${basename(legacyPath)}. Delete the ` +
        `${LEGACY_CONFIG_BASENAME}.* file.`,
    );
  } else if (!configPath && legacyPath) {
    warnings.push(
      `${LEGACY_CONFIG_BASENAME}.* is deprecated, rename to ${CONFIG_BASENAME}.* ` +
        `(found ${basename(legacyPath)}).`,
    );
  }

  const path = configPath ?? legacyPath;
  if (!path) {
    return { config: withDefaults({}), warnings };
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
    throw new AxConfigError(`Failed to load ${path}:\n  ${(err as Error).message}`);
  }

  const result = validateAxConfig(raw);
  if (!result.valid) {
    throw new AxConfigError(`${path} is invalid:\n${formatConfigErrors(result.errors)}`);
  }

  return { config: withDefaults(raw as AxConfig), path, warnings };
}

/** @deprecated Renamed to {@link loadAxConfig} along with `ard.config.*` → `ax.config.*`. */
export const loadArdConfig = loadAxConfig;

/**
 * Path of an already-present config `loadAxConfig` would honor — an `ax.config.*` first, then a
 * legacy `ard.config.*` (which `loadAxConfig` still loads). Returns undefined when neither exists.
 *
 * The legacy name is included deliberately: `ax init` uses this as its never-overwrite guard, and a
 * project running on an `ard.config.*` is already configured — writing a fresh `ax.config.*` would
 * silently shadow it (the `ax.config.*` wins, the legacy file is ignored). So "does a config already
 * exist" must ask the same question `loadAxConfig` does, not just look for the canonical name.
 */
export function findExistingConfig(cwd: string): string | undefined {
  return findConfigFile(cwd, CONFIG_BASENAME) ?? findConfigFile(cwd, LEGACY_CONFIG_BASENAME);
}

function withDefaults(config: AxConfig): ResolvedAxConfig {
  return {
    siteUrl: config.siteUrl,
    emit: config.emit ?? 'static',
    scaffoldLlmsTxt: config.scaffoldLlmsTxt ?? false,
    scaffoldAgent404: config.scaffoldAgent404 ?? false,
    scaffoldRobots: config.scaffoldRobots ?? false,
    scaffoldJsonLd: config.scaffoldJsonLd ?? false,
    // Default ON, unlike the scaffolds: twins are regenerated build artifacts (never user-owned
    // files), and their first write is confirmed at the review gate — see config-schema.ts.
    markdownTwins: config.markdownTwins ?? true,
    // `isGated` stays a possibly-undefined function (resolveGating supplies the built-in floor when
    // it's absent) — there is no data default to fill in here, unlike the other fields.
    ...(config.isGated !== undefined ? { isGated: config.isGated } : {}),
    report: config.report ?? false,
    entries: config.entries ?? [],
  };
}
