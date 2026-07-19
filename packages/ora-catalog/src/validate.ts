import type { ValidateFunction } from 'ajv';

import { ajv } from './ajv-instance.js';
import { catalogSchema } from './schema.js';
import {
  formatValidationErrors,
  toValidationError,
  type ValidationError,
} from './validation-errors.js';

/** A single validation failure, in a shape friendly to build-log output. */
export type CatalogValidationError = ValidationError;

export interface CatalogValidationResult {
  valid: boolean;
  errors: CatalogValidationError[];
}

const validateFn: ValidateFunction = ajv.compile(catalogSchema);

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
    errors: (validateFn.errors ?? []).map(toValidationError),
  };
}

/** Format validation errors into a single human-readable string for build logs / thrown errors. */
export function formatCatalogErrors(errors: CatalogValidationError[]): string {
  return formatValidationErrors(errors);
}
