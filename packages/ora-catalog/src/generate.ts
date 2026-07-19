import { loadOraCatalogConfig } from './config.js';
import { isPathDenied } from './denylist.js';
import { applyEntryOverrides, entryUrlPath } from './entries.js';
import { loadNextConfig } from './next-config.js';
import { SPEC_VERSION } from './schema.js';
import { readSiteMetadata } from './site-metadata.js';
import type { AiCatalog, CatalogEntry } from './types.js';

export interface GenerateCatalogOptions {
  /** Project root to read `package.json` / `next.config.*` / `ora-catalog.config.*` from. Defaults to `process.cwd()`. */
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
 * Loading `ora-catalog.config.*` can throw `OraCatalogConfigError` (invalid config — fails
 * loudly, by design); loading `next.config.*` never throws (warns and falls back instead).
 */
export async function generateCatalog(options: GenerateCatalogOptions = {}): Promise<AiCatalog> {
  const cwd = options.cwd ?? process.cwd();
  const warn = options.onWarning ?? (() => {});
  const site = readSiteMetadata(cwd);

  const { config } = await loadOraCatalogConfig(cwd);

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

  const inferredEntries: CatalogEntry[] = [];
  const { entries: overridden, notes } = applyEntryOverrides(inferredEntries, config.entries);
  for (const note of notes) warn(note);

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
