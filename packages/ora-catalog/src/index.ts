export {
  validateCatalog,
  formatCatalogErrors,
  type CatalogValidationResult,
  type CatalogValidationError,
} from './validate.js';

export { catalogSchema, SPEC_VERSION, SPEC_SOURCE_COMMIT } from './schema.js';

export type { AiCatalog, CatalogEntry, CatalogHost, CatalogPublisher } from './types.js';

export { generateCatalog, type GenerateCatalogOptions } from './generate.js';

export { writeCatalog, CATALOG_OUTPUT_PATH, type WriteCatalogResult } from './write.js';

export { readSiteMetadata, type SiteMetadata } from './site-metadata.js';

export { runCli, type CliIO } from './cli.js';
