// Both catalog schemas live in the repo's spec/ directory so they can be reviewed alongside the
// vendored prose spec and examples. They are imported here as JSON and inlined into the published
// bundle by tsup — the package ships no runtime dependency on spec/.
import schemaJson from '../../../spec/ai-catalog.schema.json' with { type: 'json' };
// The official ARD schema, vendored verbatim from ards-project/ard-spec (see spec/ard/README.md).
// Stricter than the base schema: urn:air identifier format, required entry displayName, closed
// root/host objects. This is the oracle the plugin's own emitted output must pass.
import ardSchemaJson from '../../../spec/ard/spec/schemas/ai-catalog.schema.json' with { type: 'json' };

/** Hand-written, deliberately permissive base AI Catalog schema (acceptance check). */
export const catalogSchema = schemaJson as Record<string, unknown>;

/** Official ARD manifest schema (strict conformance check — the emission gate). */
export const ardCatalogSchema = ardSchemaJson as Record<string, unknown>;

/** The AI Catalog spec version this schema was derived against. */
export const SPEC_VERSION = '1.0';

/** Upstream Agent-Card/ai-catalog commit the permissive base schema was derived from. */
export const SPEC_SOURCE_COMMIT = '3f7c2407aaa181f6e19d3988d0e8a4011d27c9ac';

/** Upstream ards-project/ard-spec commit the official ARD schema was vendored from. */
export const ARD_SPEC_SOURCE_COMMIT = '5fa2f5aef790b478319f6a3b43adf4661b0ed0e0';
