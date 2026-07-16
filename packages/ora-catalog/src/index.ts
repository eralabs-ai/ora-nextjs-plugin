export {
  validateCatalog,
  formatCatalogErrors,
  type CatalogValidationResult,
  type CatalogValidationError,
} from './validate.js';

export { catalogSchema, SPEC_VERSION, SPEC_SOURCE_COMMIT } from './schema.js';

export type { AiCatalog, CatalogEntry, CatalogHost, CatalogPublisher } from './types.js';
