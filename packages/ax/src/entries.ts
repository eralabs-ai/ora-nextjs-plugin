import { sanitizeDeclaredAuth } from './auth.js';
import type { AxEntryOverride } from './config-schema.js';
import type { CatalogEntry } from './types.js';

export interface ApplyEntryOverridesResult {
  entries: CatalogEntry[];
  /** One line per override applied — informational, e.g. for a build summary. */
  notes: string[];
}

/**
 * Sanitizes every override's declared `auth` in place of the raw value (see
 * {@link sanitizeDeclaredAuth}), warning once per dropped field. Run once, up front, so both
 * consumers of the overrides — the MCP mount routing and {@link applyEntryOverrides} — see the
 * same already-clean descriptors and neither re-reports the drops. An `auth` whose whole
 * declaration is unusable is removed from the override (warned), so the inferred descriptor, if
 * any, survives the merge.
 */
export function sanitizeOverrideAuth(
  overrides: readonly AxEntryOverride[],
  warn: (message: string) => void,
): AxEntryOverride[] {
  return overrides.map((override) => {
    if (!('auth' in override)) return override;
    const { auth, dropped } = sanitizeDeclaredAuth(override.auth);
    for (const drop of dropped) {
      warn(
        `Entry "${override.identifier}" in ax.config declares an auth field ax won't emit: ${drop}.`,
      );
    }
    if (auth === undefined) {
      const { auth: _invalid, ...rest } = override;
      return rest as AxEntryOverride;
    }
    return { ...override, auth };
  });
}

/**
 * Applies config-declared entry overrides over a set of inferred entries.
 *
 * Config overrides/extends inferred entries; it never silently replaces them. So: an override
 * whose `identifier` matches an inferred entry is shallow-merged into it (override fields win;
 * fields it doesn't mention are kept from the inferred entry) — it never removes an inferred
 * entry outright. An override with no matching `identifier` is appended as a new entry.
 *
 * A declared `auth` wins over a detected one, like every other override field — but auth is the
 * one field where the inferred value is *also* a committed declaration agents read (an OpenAPI
 * doc's `securitySchemes`), so a status disagreement is warned, never silent.
 */
export function applyEntryOverrides(
  inferred: readonly CatalogEntry[],
  overrides: readonly AxEntryOverride[],
  warn?: (message: string) => void,
): ApplyEntryOverridesResult {
  const entries = inferred.map((entry) => ({ ...entry }));
  const notes: string[] = [];

  for (const override of overrides) {
    const index = entries.findIndex((entry) => entry.identifier === override.identifier);
    if (index === -1) {
      entries.push({ ...override } as CatalogEntry);
      notes.push(`config declared a new entry: ${override.identifier}`);
    } else {
      const inferredAuth = entries[index]?.auth;
      const declaredAuth = override.auth;
      if (
        inferredAuth !== undefined &&
        declaredAuth !== undefined &&
        inferredAuth.status !== declaredAuth.status
      ) {
        warn?.(
          `Entry "${override.identifier}": ax.config declares auth.status "${declaredAuth.status}" ` +
            `but the surface's own declaration derives "${inferredAuth.status}" — the config wins, ` +
            'but agents also read the source declaration, so align the two.',
        );
      }
      entries[index] = { ...entries[index], ...override } as CatalogEntry;
      notes.push(`config extended inferred entry: ${override.identifier}`);
    }
  }

  return { entries, notes };
}

/**
 * The URL path a catalog entry would be served at, for `isGated` matching. Entries with `data`
 * instead of `url` (spec allows either) have no path to match, so they're never gated on path.
 */
export function entryUrlPath(entry: Pick<CatalogEntry, 'url'>): string | undefined {
  if (typeof entry.url !== 'string' || entry.url === '') return undefined;
  try {
    return new URL(entry.url, 'http://ax.invalid').pathname;
  } catch {
    return undefined;
  }
}
