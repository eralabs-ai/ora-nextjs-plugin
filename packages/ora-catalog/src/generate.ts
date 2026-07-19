import { loadArdConfig } from './config.js';
import { isPathDenied } from './denylist.js';
import { applyEntryOverrides, entryUrlPath } from './entries.js';
import { loadNextConfig } from './next-config.js';
import { SPEC_VERSION } from './schema.js';
import { readSiteMetadata } from './site-metadata.js';
import type { AiCatalog, CatalogEntry } from './types.js';

export interface GenerateCatalogOptions {
  /** Project root to read `package.json` / `next.config.*` / `ard.config.*` from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Called with non-fatal build-time notices (next.config fallback, denylist drops, ...). */
  onWarning?: (message: string) => void;
}

/**
 * Builds the catalog: site-level `host` metadata, plus config-declared entries
 * (overrides/extends — PLAN.md 2.1) filtered through the denylist/allowlist. Zero-config artifact
 * *detection* (MCP, OpenAPI, docs/skills, llms.txt) is Phase 2.2 — until then `inferredEntries` is
 * always empty, so config-declared entries are the only source of entries.
 *
 * Loading `ard.config.*` can throw `ArdConfigError` (invalid config — fails loudly, by design);
 * loading `next.config.*` never throws (warns and falls back instead).
 */
export async function generateCatalog(options: GenerateCatalogOptions = {}): Promise<AiCatalog> {
  const cwd = options.cwd ?? process.cwd();
  const warn = options.onWarning ?? (() => {});
  const site = readSiteMetadata(cwd);

  const { config } = await loadArdConfig(cwd);

  const nextConfig = await loadNextConfig(cwd);
  for (const warning of nextConfig.warnings) warn(warning);
  if (nextConfig.config.basePath) {
    warn(
      `next.config sets basePath "${nextConfig.config.basePath}" — the static ` +
        'public/.well-known/ai-catalog.json will only be served under that prefix, not at the ' +
        'domain root crawlers expect (a basePath-aware route-handler emission target is planned ' +
        'for Phase 2.4).',
    );
  }

  // Declaring entries in config is expected, not noteworthy — the per-entry notes
  // (`applyEntryOverrides().notes`) are left for the Phase 2.3 build summary rather than surfaced
  // as warnings here. A denylist *exclusion*, below, is worth warning about: the developer
  // declared something that then got dropped.
  const inferredEntries: CatalogEntry[] = [];
  const { entries: overridden } = applyEntryOverrides(inferredEntries, config.entries);

  const entries = overridden.filter((entry) => {
    const path = entryUrlPath(entry);
    if (path === undefined) return true;
    if (isPathDenied(path, config.denylist, config.allowlist)) {
      warn(`denylist excluded entry "${entry.identifier}" (${path})`);
      return false;
    }
    return true;
  });

  return {
    specVersion: SPEC_VERSION,
    host: {
      displayName: site.displayName,
      ...(site.description !== undefined ? { description: site.description } : {}),
      ...(site.domain !== undefined ? { identifier: `did:web:${site.domain}` } : {}),
    },
    entries,
  };
}
