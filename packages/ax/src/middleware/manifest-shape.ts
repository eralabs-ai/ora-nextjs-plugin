// The shape of the generated `ax-manifest` data module, as the runtime middleware reads it. This
// is the build/runtime contract in one type: the build step (which knows the route table, which
// twins exist, and what is gated) writes a module matching this shape, and the middleware (which
// knows none of that) consumes it — the reason it can negotiate without ever rewriting blind.
//
// Deliberately dependency-free and readonly-everything: the generated module is `as const`, and
// the middleware must be able to type against it without importing anything from the CLI side.
// The build-side writer (`ServingManifestData` in src/manifest.ts) is asserted assignable to this
// type in tests, so the two ends of the contract cannot drift apart silently.

/** The data the generated `ax-manifest.{ts,js}` module exports. Every path is a served (basePath-prefixed) URL path. */
export interface AxServingManifest {
  /** `next.config` `basePath`, or `''`. */
  readonly basePath: string;
  /** Every statically addressable page route, served-path form. */
  readonly routes: readonly string[];
  /**
   * Static served-path prefixes under which dynamic routes live — the middleware never claims
   * "not found" under one. Optional: manifests generated before this field existed lack it.
   */
  readonly dynamicRoutePrefixes?: readonly string[];
  /** Served route path → served markdown-twin path, for every route with a twin on disk. */
  readonly markdownTwins: Readonly<Record<string, string>>;
  /** Served paths the gating policy marks gated — never rewritten to markdown, never advertised. */
  readonly gatedPaths: readonly string[];
  /** Where the discovery artifacts actually live; a member is present only when its source exists. */
  readonly artifacts: {
    readonly aiCatalog?: string;
    readonly mcpServerCard?: string;
    readonly mcpServerCards?: readonly string[];
    readonly llmsTxt?: string;
    readonly authMd?: string;
    readonly notFoundMd?: string;
    readonly openapi?: string;
  };
}
