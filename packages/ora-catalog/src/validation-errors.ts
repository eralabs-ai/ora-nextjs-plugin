import type { ErrorObject } from 'ajv';

/** A single validation failure, in a shape friendly to build-log output. */
export interface ValidationError {
  /** JSON Pointer to the offending location, e.g. `/entries/0/url`. */
  instancePath: string;
  /** The failed keyword, e.g. `required`, `oneOf`, `pattern`. */
  keyword: string;
  /** Human-readable message from Ajv. */
  message: string;
  /** Keyword-specific parameters (e.g. the missing property name). */
  params: Record<string, unknown>;
}

export function toValidationError(err: ErrorObject): ValidationError {
  return {
    instancePath: err.instancePath,
    keyword: err.keyword,
    message: err.message ?? 'validation failed',
    params: err.params as Record<string, unknown>,
  };
}

/** Format validation errors into a single human-readable string for build logs / thrown errors. */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return 'no errors';
  return errors
    .map((e) => {
      const at = e.instancePath === '' ? '(root)' : e.instancePath;
      return `  • ${at} ${e.message}`;
    })
    .join('\n');
}
