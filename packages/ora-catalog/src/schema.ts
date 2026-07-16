// The canonical, hand-written AI Catalog JSON Schema lives in the repo's spec/ directory so it can
// be reviewed alongside the vendored prose spec and example. It is imported here as JSON and inlined
// into the published bundle by tsup — the package ships no runtime dependency on spec/.
import schemaJson from '../../../spec/ai-catalog.schema.json' with { type: 'json' };

export const catalogSchema = schemaJson as Record<string, unknown>;

/** The AI Catalog spec version this schema was derived against. */
export const SPEC_VERSION = '1.0';

/** Upstream Agent-Card/ai-catalog commit the schema was derived from. */
export const SPEC_SOURCE_COMMIT = '3f7c2407aaa181f6e19d3988d0e8a4011d27c9ac';
