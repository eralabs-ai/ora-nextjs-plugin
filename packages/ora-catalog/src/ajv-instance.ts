import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// One Ajv instance, shared by every schema this package validates against (the vendored AI
// Catalog spec in validate.ts, and this package's own ora-catalog.config schema in
// validate-config.ts). Deliberately the *only* schema-validation library in the dependency tree —
// see PLAN.md 2.1: this is build-time tooling, so dependency count matters, and one JSON Schema
// validator can validate any parsed JS object regardless of whether it started life as JSON or as
// a `.ts` config file.
export const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
