# ARD spec — vendored official artifacts

The ARD spec ([agenticresourcediscovery.org/spec](https://agenticresourcediscovery.org/spec/))
publishes **formal schemas and an official conformance tool** in
[ards-project/ard-spec](https://github.com/ards-project/ard-spec) (Apache-2.0). This supersedes the
earlier Phase 0.2 finding that no formal schema existed — that finding was true of the base
[Agent-Card/ai-catalog](https://github.com/Agent-Card/ai-catalog) repo, but the ARD layer (which is
what Ora's registry targets) ships machine-checkable artifacts. They are vendored here **verbatim**,
preserving the upstream directory layout so the conformance tool's relative schema lookup
(`../../spec/schemas/ai-catalog.schema.json`) keeps working unmodified.

## Provenance

**Vendored from ards-project/ard-spec commit:** `5fa2f5aef790b478319f6a3b43adf4661b0ed0e0`

| Artifact                                     | Upstream path | Role here                                                                         |
| -------------------------------------------- | ------------- | --------------------------------------------------------------------------------- |
| `spec/schemas/ai-catalog.schema.json`        | same          | **Strict emission oracle** — every catalog this plugin writes must pass it.       |
| `conformance/bin/conformance-test`           | same          | Official zero-dependency Python conformance CLI; run over fixture catalogs in CI. |
| `conformance/examples/basic/ai-catalog.json` | same          | Official example manifest — a must-validate test case.                            |

The authoritative CDDL (`spec/schemas/ard.cddl`) and the registry OpenAPI spec
(`spec/schemas/ard.openapi.yaml`) are _not_ vendored — this plugin emits manifests only and consumes
neither.

## Two oracles, two roles

- `spec/ai-catalog.schema.json` (one level up, hand-written) stays as the **permissive acceptance**
  check for the base AI Catalog format — "reject only what the spec explicitly forbids". The
  upstream Agent-Card example still validates against it (and would _fail_ the ARD schema: it has an
  entry without `displayName` and non-`urn:air:` identifiers — the two layers genuinely differ).
- `spec/ard/spec/schemas/ai-catalog.schema.json` (this directory, vendored) is the **strict ARD
  conformance** check applied to everything this plugin _emits_ (`writeCatalog` hard-fails on it).
  Notable constraints beyond the base layer: entry `identifier` must match
  `^urn:air:<publisher>:<segments>`, entry `displayName` is required, `specVersion` is exactly
  `"1.0"`, and the manifest root and `host` object are closed (`additionalProperties: false` — no
  `host.description`, for example). Entries themselves remain open for extension fields
  (`auth`, top-level `provenance`, ...).

## Upgrade policy

Same as the base spec: bumps are explicit PRs with a changelog entry, never silent updates. When
upstream moves, bump the pinned commit above, re-vendor all three files, and reconcile
`packages/ax` (the schema is inlined into the published bundle at build time).

## Running the conformance tool locally

```sh
# One fixture's generated catalog (pip install jsonschema first for the strict schema check):
./spec/ard/conformance/bin/conformance-test manifest fixtures/openapi/public/.well-known/ai-catalog.json

# All fixture catalogs (what CI runs):
pnpm conformance
```
