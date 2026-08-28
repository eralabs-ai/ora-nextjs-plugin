import { basename } from 'node:path';

import { createJiti } from 'jiti';

import type { AxConfig, ResolvedAxConfig } from './config-schema.js';
import { findConfigFile } from './find-config-file.js';
import { formatConfigErrors, validateAxConfig } from './validate-config.js';

/** Canonical config basename, named after the `ax` CLI this package ships. */
const CONFIG_BASENAME = 'ax.config';

/**
 * `ax.config`'s pre-rename name. No longer loaded at all — this package is pre-1.0, so the
 * maintainer would rather force a one-line rename now than carry a second config surface (and its
 * own warning/precedence logic) indefinitely. Kept only to spot the file and fail loudly (see
 * `loadAxConfig`) rather than silently build with defaults while the user's real settings sit
 * unread.
 */
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

export interface LoadAxConfigResult {
  config: ResolvedAxConfig;
  /** Absolute path of the config file that was loaded, or undefined when none was found. */
  path?: string;
}

/**
 * Finds and loads `ax.config.{ts,mts,cts,mjs,js,cjs}` from `cwd`, validates it against this
 * package's own schema, and returns it with every optional field defaulted.
 *
 * A missing file is a normal, silent case (defaults apply, nothing to warn about) — *unless* a
 * pre-rename `ard.config.*` is sitting there instead. That case must not fall through to defaults:
 * the project has real settings, just under a name this loader no longer reads, and silently
 * building with defaults would drop them without telling anyone. So it throws `AxConfigError`
 * pointing at the rename, exactly as loudly as an invalid `ax.config.*` does below. When an
 * `ax.config.*` exists, any `ard.config.*` alongside it is ignored outright — the new file already
 * won, so there's nothing left to warn about.
 */
export async function loadAxConfig(cwd: string): Promise<LoadAxConfigResult> {
  const configPath = findConfigFile(cwd, CONFIG_BASENAME);

  if (!configPath) {
    const legacyPath = findConfigFile(cwd, LEGACY_CONFIG_BASENAME);
    if (legacyPath) {
      throw new AxConfigError(
        `${basename(legacyPath)} found, but ${LEGACY_CONFIG_BASENAME}.* is no longer supported. ` +
          `Rename it to ${CONFIG_BASENAME}${basename(legacyPath).slice(LEGACY_CONFIG_BASENAME.length)}.`,
      );
    }
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
    raw = await jiti.import(configPath, { default: true });
  } catch (err) {
    throw new AxConfigError(`Failed to load ${configPath}:\n  ${(err as Error).message}`);
  }

  const result = validateAxConfig(raw);
  if (!result.valid) {
    throw new AxConfigError(`${configPath} is invalid:\n${formatConfigErrors(result.errors)}`);
  }

  return { config: withDefaults(raw as AxConfig), path: configPath };
}

/**
 * Path of an already-present `ax.config.*`, or undefined when none exists.
 *
 * Deliberately does *not* look for a legacy `ard.config.*` — `ax init`'s never-overwrite guard uses
 * this to decide whether a project is already configured, and an `ard.config.*`-only project isn't
 * "already configured" in that sense; it just happens to also be a project `ax init` can't actually
 * proceed on (its detection pass calls `loadAxConfig`, which rejects that project shape). `init.ts`
 * handles that separately, by catching the `AxConfigError` detection throws rather than by teaching
 * this guard about the legacy name again.
 */
export function findExistingConfig(cwd: string): string | undefined {
  return findConfigFile(cwd, CONFIG_BASENAME);
}

function withDefaults(config: AxConfig): ResolvedAxConfig {
  return {
    siteUrl: config.siteUrl,
    emit: config.emit ?? 'static',
    scaffoldLlmsTxt: config.scaffoldLlmsTxt ?? false,
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
