export {
  validateCatalog,
  validateCatalogArd,
  formatCatalogErrors,
  type CatalogValidationResult,
  type CatalogValidationError,
} from './validate.js';

export {
  catalogSchema,
  ardCatalogSchema,
  SPEC_VERSION,
  SPEC_SOURCE_COMMIT,
  ARD_SPEC_SOURCE_COMMIT,
} from './schema.js';

export type { AiCatalog, CatalogEntry, CatalogHost, CatalogPublisher } from './types.js';

export {
  generateCatalog,
  type GenerateCatalogOptions,
  type GenerateCatalogResult,
} from './generate.js';

export {
  writeCatalog,
  writeServerCard,
  CATALOG_OUTPUT_PATH,
  SERVER_CARD_OUTPUT_PATH,
  type WriteCatalogResult,
  type WriteServerCardResult,
  type WriteCatalogOptions,
  type EmissionTarget,
} from './write.js';

export { readSiteMetadata, type SiteMetadata } from './site-metadata.js';

export { runCli, type CliIO } from './cli.js';

export {
  ardConfigSchema,
  DEFAULT_DENYLIST,
  type ArdConfig,
  type ArdEntryOverride,
  type ResolvedArdConfig,
} from './config-schema.js';

export { loadArdConfig, ArdConfigError, type LoadArdConfigResult } from './config.js';

export {
  validateArdConfig,
  formatConfigErrors,
  type ConfigValidationResult,
  type ConfigValidationError,
} from './validate-config.js';

export {
  loadNextConfig,
  type ExtractedNextConfig,
  type LoadNextConfigResult,
} from './next-config.js';

export { isPathDenied, matchesAnyGlob } from './denylist.js';

export { applyEntryOverrides, entryUrlPath, type ApplyEntryOverridesResult } from './entries.js';

export { resolveSiteUrl, buildArtifactUrl, buildUrn, hostnameFromUrl } from './site-url.js';

export { findAppDir } from './app-dir.js';

export {
  detectMcpServers,
  detectMcpMounts,
  buildMcpEntries,
  type DetectMcpOptions,
  type DetectMcpMountsOptions,
  type BuildMcpEntriesOptions,
  type McpMount,
} from './detect-mcp.js';

export {
  buildMcpServerCard,
  type McpServerCard,
  type McpServerCardTool,
  type McpServerCardRemote,
  type BuildMcpServerCardOptions,
} from './server-card.js';

export { detectOpenApi, type DetectOpenApiOptions } from './detect-openapi.js';

export {
  detectJsonLd,
  type DetectJsonLdOptions,
  type DetectJsonLdResult,
} from './detect-json-ld.js';

export {
  detectLlmsTxt,
  type DetectLlmsTxtOptions,
  type DetectLlmsTxtResult,
} from './detect-llms-txt.js';

export {
  detectRobots,
  type DetectRobotsOptions,
  type DetectRobotsResult,
} from './detect-robots.js';

export {
  detectSitemap,
  type DetectSitemapOptions,
  type DetectSitemapResult,
} from './detect-sitemap.js';

export {
  detectAgentsMd,
  type DetectAgentsMdOptions,
  type DetectAgentsMdResult,
} from './detect-agents-md.js';

export {
  catalogServedPath,
  buildDiscoveryRecommendations,
  type DiscoveryRecommendationOptions,
} from './discovery.js';
