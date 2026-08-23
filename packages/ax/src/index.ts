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

export type {
  BuildReport,
  ReportArtifact,
  ReportScaffolds,
  ReportMarkdownTwins,
  OraReport,
} from './report.js';

export {
  measureArtifact,
  measureContent,
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

export { runInit, validateSiteUrl, type InitIO } from './init.js';

export {
  renderAxConfig,
  configFileName,
  CONFIG_BASENAME,
  type InitAnswers,
  type ConfigFileTarget,
} from './init-config.js';

export {
  planPostbuildWiring,
  planPrebuildWiring,
  POSTBUILD_COMMAND,
  PREBUILD_COMMAND,
  type PostbuildWiring,
} from './init-package-json.js';

export { createReadlinePrompter, type Prompter, type MultiSelectChoice } from './prompt.js';

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
  findExistingConfig,
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
  servedPath,
  absoluteOrServedUrl,
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
  GENERATED_BY,
  renderFrontmatter,
  isGeneratedMarkdown,
  fenceMarkerCount,
  type MarkdownFrontmatter,
} from './markdown-artifact.js';

export { deriveMdxTwin, MDX_MAX_NON_MARKDOWN_FRACTION, type MdxTwinResult } from './mdx-twin.js';

export {
  deriveHtmlTwin,
  MIN_TWIN_TEXT_CHARS,
  MAX_TWIN_CHARS,
  type HtmlTwinResult,
  type HtmlTwinSkipReason,
} from './html-twin.js';

export {
  planMarkdownTwins,
  applyMarkdownTwinPlan,
  twinPathnameForRoute,
  type MarkdownTwinPlan,
  type PlannedTwin,
  type UserOwnedTwin,
  type TwinSkip,
  type TwinSkipReason,
  type TwinTier,
  type PlanMarkdownTwinsOptions,
  type ApplyTwinPlanResult,
} from './markdown-twins.js';

export {
  buildAuthMd,
  applyAuthMdPlan,
  AUTH_MD_PATHNAME,
  type AuthMdPlan,
  type BuildAuthMdOptions,
  type ApplyAuthMdResult,
} from './auth-md.js';

export {
  buildServingManifest,
  writeServingManifest,
  refreshServingManifestIfPresent,
  existingManifestModulePath,
  manifestModulePath,
  renderManifestModule,
  MANIFEST_MODULE_BASE,
  type ServingManifestData,
  type BuildServingManifestOptions,
  type WriteServingManifestResult,
} from './manifest.js';

export {
  AI_AGENT_UA_PATTERNS,
  SIGNATURE_AGENT_DOMAINS,
  TRADITIONAL_BOT_PATTERNS,
  BOT_LIKE_REGEX,
  REPUTABLE_AI_CRAWLERS,
  TRAINING_ONLY_CRAWLERS,
  UA_CORPUS_REVIEWED,
} from './agent-ua.js';

export { listStaticPageRoutes, resolvePagePathname, listMdxPageFiles } from './app-dir.js';
