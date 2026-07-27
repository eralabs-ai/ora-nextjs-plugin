import type { ValidateFunction } from 'ajv';

import { ajv } from './ajv-instance.js';
import { ardCatalogSchema, catalogSchema } from './schema.js';
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
const validateArdFn: ValidateFunction = ajv.compile(ardCatalogSchema);

function runValidator(fn: ValidateFunction, json: unknown): CatalogValidationResult {
  const valid = fn(json) as boolean;
  if (valid) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: (fn.errors ?? []).map(toValidationError),
  };
}

/**
 * Validate a parsed JSON value against the permissive base AI Catalog schema — "is this a valid
 * catalog at all?". Never throws; returns pass/fail plus structured errors.
 */
export function validateCatalog(json: unknown): CatalogValidationResult {
  return runValidator(validateFn, json);
}

/**
 * Validate against the official ARD schema (vendored from ards-project/ard-spec) — the strict
 * conformance oracle every catalog this plugin *emits* must pass before it is written. Anything
 * ARD-valid is also base-valid, so `writeCatalog` gates on this alone. Beyond the base schema it
 * enforces `urn:air:<publisher>:...` identifiers, required entry `displayName`, `specVersion`
 * exactly "1.0", and closed root/host objects.
 */
export function validateCatalogArd(json: unknown): CatalogValidationResult {
  return runValidator(validateArdFn, json);
}

/** Format validation errors into a single human-readable string for build logs / thrown errors. */
export function formatCatalogErrors(errors: CatalogValidationError[]): string {
  return formatValidationErrors(errors);
}
