import type { ArdEntryOverride } from './config-schema.js';
import type { CatalogEntry } from './types.js';

export interface ApplyEntryOverridesResult {
  entries: CatalogEntry[];
  /** One line per override applied — informational, e.g. for a build summary. */
  notes: string[];
}

/**
 * Applies config-declared entry overrides over a set of inferred entries.
 *
 * PLAN.md 2.1: "Config overrides/extends inferred entries; it never silently replaces them." So:
 * an override whose `identifier` matches an inferred entry is shallow-merged into it (override
 * fields win; fields it doesn't mention are kept from the inferred entry) — it never removes an
 * inferred entry outright. An override with no matching `identifier` is appended as a new entry.
 */
export function applyEntryOverrides(
  inferred: readonly CatalogEntry[],
  overrides: readonly ArdEntryOverride[],
): ApplyEntryOverridesResult {
  const entries = inferred.map((entry) => ({ ...entry }));
  const notes: string[] = [];

  for (const override of overrides) {
    const index = entries.findIndex((entry) => entry.identifier === override.identifier);
    if (index === -1) {
      entries.push({ ...override } as CatalogEntry);
      notes.push(`config declared a new entry: ${override.identifier}`);
    } else {
      entries[index] = { ...entries[index], ...override } as CatalogEntry;
      notes.push(`config extended inferred entry: ${override.identifier}`);
    }
  }

  return { entries, notes };
}

/**
 * The URL path a catalog entry would be served at, for denylist/allowlist matching. Entries with
 * `data` instead of `url` (spec allows either) have no path to match, so they're never denied.
 */
export function entryUrlPath(entry: Pick<CatalogEntry, 'url'>): string | undefined {
  if (typeof entry.url !== 'string' || entry.url === '') return undefined;
  try {
    return new URL(entry.url, 'http://ora-catalog.invalid').pathname;
  } catch {
    return undefined;
  }
}
