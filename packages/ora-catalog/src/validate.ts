import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { catalogSchema } from './schema.js';

/** A single validation failure, in a shape friendly to build-log output. */
export interface CatalogValidationError {
  /** JSON Pointer to the offending location, e.g. `/entries/0/url`. */
  instancePath: string;
  /** The failed keyword, e.g. `required`, `oneOf`, `pattern`. */
  keyword: string;
  /** Human-readable message from Ajv. */
  message: string;
  /** Keyword-specific parameters (e.g. the missing property name). */
  params: Record<string, unknown>;
}

export interface CatalogValidationResult {
  valid: boolean;
  errors: CatalogValidationError[];
}

// One compiled validator, reused across calls. strict:false keeps us permissive — the schema
// deliberately allows unknown properties, and we don't want strict-mode meta warnings to throw.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validateFn: ValidateFunction = ajv.compile(catalogSchema);

function toError(err: ErrorObject): CatalogValidationError {
  return {
    instancePath: err.instancePath,
    keyword: err.keyword,
    message: err.message ?? 'validation failed',
    params: err.params as Record<string, unknown>,
  };
}

/**
 * Validate a parsed JSON value against the AI Catalog schema — the oracle every generated catalog
 * must pass before it is written. Never throws; returns pass/fail plus structured errors.
 */
export function validateCatalog(json: unknown): CatalogValidationResult {
  const valid = validateFn(json) as boolean;
  if (valid) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: (validateFn.errors ?? []).map(toError),
  };
}

/** Format validation errors into a single human-readable string for build logs / thrown errors. */
export function formatCatalogErrors(errors: CatalogValidationError[]): string {
  if (errors.length === 0) return 'no errors';
  return errors
    .map((e) => {
      const at = e.instancePath === '' ? '(root)' : e.instancePath;
      return `  • ${at} ${e.message}`;
    })
    .join('\n');
}
