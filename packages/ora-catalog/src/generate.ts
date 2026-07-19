import type { AiCatalog } from './types.js';
import { SPEC_VERSION } from './schema.js';
import { readSiteMetadata } from './site-metadata.js';

export interface GenerateCatalogOptions {
  /** Project root to read `package.json` from. Defaults to `process.cwd()`. */
  cwd?: string;
}

/**
 * Builds the Phase 1 walking-skeleton catalog: site-level `host` metadata only, an empty
 * `entries` array. Zero-config artifact detection (MCP, OpenAPI, docs/skills, llms.txt) is
 * Phase 2 — this is deliberately the thinnest spec-valid slice.
 */
export function generateCatalog(options: GenerateCatalogOptions = {}): AiCatalog {
  const cwd = options.cwd ?? process.cwd();
  const site = readSiteMetadata(cwd);

  return {
    specVersion: SPEC_VERSION,
    host: {
      displayName: site.displayName,
      ...(site.description !== undefined ? { description: site.description } : {}),
      ...(site.domain !== undefined ? { identifier: `did:web:${site.domain}` } : {}),
    },
    entries: [],
  };
}
