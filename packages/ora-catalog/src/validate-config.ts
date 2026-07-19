import type { ValidateFunction } from 'ajv';

import { ajv } from './ajv-instance.js';
import { oraCatalogConfigSchema } from './config-schema.js';
import {
  formatValidationErrors,
  toValidationError,
  type ValidationError,
} from './validation-errors.js';

export type ConfigValidationError = ValidationError;

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
}

const validateFn: ValidateFunction = ajv.compile(oraCatalogConfigSchema);

/**
 * Validate a parsed `ora-catalog.config.*` module's default export against this package's own
 * config schema. This is the "build-time validation fails loudly" gate from PLAN.md 2.1 — an
 * invalid config must never be silently ignored or half-applied.
 */
export function validateOraCatalogConfig(json: unknown): ConfigValidationResult {
  const valid = validateFn(json) as boolean;
  if (valid) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: (validateFn.errors ?? []).map(toValidationError),
  };
}

export function formatConfigErrors(errors: ConfigValidationError[]): string {
  return formatValidationErrors(errors);
}
