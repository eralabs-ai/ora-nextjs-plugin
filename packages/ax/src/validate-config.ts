import type { ValidateFunction } from 'ajv';

import { ajv } from './ajv-instance.js';
import { axConfigSchema } from './config-schema.js';
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

const validateFn: ValidateFunction = ajv.compile(axConfigSchema);

/**
 * Validate a parsed `ax.config.*` module's default export against this package's own config
 * schema. This is the "build-time validation fails loudly" gate — an invalid config must never be
 * silently ignored or half-applied.
 *
 * `isGated` is a function, which JSON Schema has no type for and which the closed
 * (`additionalProperties: false`) top-level schema would otherwise reject outright. So it's split
 * out before Ajv runs and validated with a `typeof` check: present-but-not-callable is a loud
 * error, a real function passes, absence is fine.
 */
export function validateAxConfig(json: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];

  let toValidate = json;
  if (typeof json === 'object' && json !== null && 'isGated' in json) {
    const { isGated, ...rest } = json as Record<string, unknown>;
    toValidate = rest;
    if (typeof isGated !== 'function') {
      errors.push({
        instancePath: '/isGated',
        keyword: 'type',
        message: 'must be a function: (target) => boolean',
        params: {},
      });
    }
  }

  if (!validateFn(toValidate)) {
    errors.push(...(validateFn.errors ?? []).map(toValidationError));
  }

  return { valid: errors.length === 0, errors };
}

export function formatConfigErrors(errors: ConfigValidationError[]): string {
  return formatValidationErrors(errors);
}

/** @deprecated Renamed to {@link validateAxConfig} along with `ard.config.*` → `ax.config.*`. */
export const validateArdConfig = validateAxConfig;
