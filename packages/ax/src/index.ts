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

export type {
  AiCatalog,
  CatalogEntry,
  CatalogHost,
  CatalogPublisher,
  EntryAuth,
  EntryAuthOAuth,
  EntryAuthStatus,
} from './types.js';

export {
  generateCatalog,
  type GenerateCatalogOptions,
  type GenerateCatalogResult,
} from './generate.js';

export {
  writeCatalog,
  writeServerCard,
  writeReport,
  CATALOG_OUTPUT_PATH,
  SERVER_CARD_OUTPUT_PATH,
  REPORT_OUTPUT_PATH,
  type WriteCatalogResult,
  type WriteServerCardResult,
  type WriteCatalogOptions,
  type EmissionTarget,
} from './write.js';

export type { BuildReport, ReportArtifact, ReportScaffolds, OraReport } from './report.js';

export {
  measureArtifact,
  estimateTokens,
  formatArtifactSize,
  formatTokens,
  humanSize,
  exceedsTruncationLimit,
  TRUNCATION_CHAR_LIMIT,
  type ArtifactSize,
} from './artifact-size.js';

export {
  buildOraChecks,
  ORA_CHECK_MAP,
  ORA_SCAN_API,
  ORA_SKILL_MCP_URL,
  ORA_SKILL_URL,
  type OraArtifact,
  type OraArtifactChecks,
  type OraArtifactPresence,
  type OraCheckState,
  type OraCheckStatus,
} from './ora-checks.js';

export {
  scaffoldRobots,
  type ScaffoldRobotsOptions,
  type RobotsScaffoldAction,
  type RobotsScaffoldResult,
} from './scaffold-robots.js';

export {
  scaffoldOrganizationJsonLd,
  JSON_LD_COMPONENT_BASE,
  type ScaffoldJsonLdOptions,
  type JsonLdScaffoldAction,
  type JsonLdScaffoldResult,
  type JsonLdWiring,
} from './scaffold-json-ld.js';

export { readSiteMetadata, type SiteMetadata } from './site-metadata.js';

export { runCli, type CliIO } from './cli.js';

export {
  axConfigSchema,
  type AxConfig,
  type AxEntryOverride,
  type ResolvedAxConfig,
  // Deprecated pre-`ax.config` names, kept so existing imports keep resolving.
  ardConfigSchema,
  type ArdConfig,
  type ArdEntryOverride,
  type ResolvedArdConfig,
} from './config-schema.js';

export {
  loadAxConfig,
  AxConfigError,
  type LoadAxConfigResult,
  loadArdConfig,
  ArdConfigError,
  type LoadArdConfigResult,
} from './config.js';

export {
  validateAxConfig,
  formatConfigErrors,
  type ConfigValidationResult,
  type ConfigValidationError,
  validateArdConfig,
} from './validate-config.js';

export {
  loadNextConfig,
  type ExtractedNextConfig,
  type LoadNextConfigResult,
} from './next-config.js';

export {
  defaultIsGated,
  resolveGating,
  matchesAnyGlob,
  DEFAULT_GATED_GLOBS,
  type GateTarget,
  type IsGated,
} from './gating.js';

export { authForOpenApi, safeHttpUrl } from './auth.js';

export { applyEntryOverrides, entryUrlPath, type ApplyEntryOverridesResult } from './entries.js';

export {
  resolveSiteUrl,
  readSiteUrlFromEnv,
  buildArtifactUrl,
  buildUrn,
  hostnameFromUrl,
} from './site-url.js';

export { findAppDir } from './app-dir.js';

export { findPagesDir, listStaticPagesRoutes, resolvePagesPathname } from './pages-dir.js';

export {
  buildRouterModel,
  type RouterModel,
  type RouterKind,
  type ApiEndpoint,
} from './router-model.js';

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
  type McpServerCardAuthentication,
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
  type LlmsTxtResources,
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

export {
  buildMarkdownAlternateRecommendation,
  type MarkdownAlternateOptions,
} from './markdown-alternate.js';

export {
  detectWebMcp,
  type DetectWebMcpOptions,
  type DetectWebMcpResult,
  type WebMcpToolSite,
} from './detect-webmcp.js';

export { manageAgent404, type Agent404Options, type Agent404Result } from './agent-404.js';

export {
  applyMarkdownHeaders,
  canonicalLinkHeader,
  type MarkdownHeaderOptions,
} from './markdown-headers.js';

export {
  AI_AGENT_UA_PATTERNS,
  SIGNATURE_AGENT_DOMAINS,
  TRADITIONAL_BOT_PATTERNS,
  BOT_LIKE_REGEX,
  REPUTABLE_AI_CRAWLERS,
  TRAINING_ONLY_CRAWLERS,
  UA_CORPUS_REVIEWED,
} from './agent-ua.js';

export { listStaticPageRoutes, resolvePagePathname } from './app-dir.js';
