# AI Catalog spec — vendored surface & oracle

The upstream [Agent-Card/ai-catalog](https://github.com/Agent-Card/ai-catalog) repo publishes a
**prose spec only** — no JSON Schema, CDDL, or OpenAPI (verified 2026-07-16). This directory is our
pinned, machine-checkable surface derived from that prose.

## Provenance

| Artifact                            | Source                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ai-catalog.md`                     | Vendored prose spec (structural sections).                                                            |
| `examples/upstream-ai-catalog.json` | Vendored verbatim from upstream `specification/examples/ai-catalog.json` — a must-validate test case. |
| `ai-catalog.schema.json`            | **Hand-written** by us, derived from the prose. Deliberately permissive (see below).                  |

**Derived from upstream commit:** `3f7c2407aaa181f6e19d3988d0e8a4011d27c9ac`
(`specification/ai-catalog.md`).

## Upgrade policy

Spec bumps are **explicit PRs with a changelog entry, never silent updates**. When upstream moves,
bump the commit above, re-vendor `ai-catalog.md` and the example, reconcile `ai-catalog.schema.json`,
and note the spec-version change in a changeset.

## Schema philosophy: permissive, reject only what's forbidden

`ai-catalog.schema.json` is the oracle everything in this repo tests against (`validateCatalog`). The
prose is ambiguous in places; where it is, we accept rather than reject:

- **`type` is an open string**, never an enum — IANA media-type registrations are not final (ADR
  note in the plan). Known types are documented, not enforced.
- **Unknown properties are allowed** on every object — the spec says consumers SHOULD ignore
  unrecognized keys, and `metadata` is explicitly open (`string → any`).
- We enforce only what the prose **requires**: required fields, the "exactly one of `url` / `data`"
  rule on entries, and the `specVersion` `Major.Minor` shape.

## Trust Manifest

Trust Manifest / attestations are a large part of the full spec but are **out of scope for v1
emission**. The schema accepts a `trustManifest` object permissively (any shape) so a catalog that
carries one still validates; the plugin does not emit one in v1.

## `.well-known` location

Per upstream ADR-0011 the `.well-known` **requirement** was dropped; `/.well-known/ai-catalog.json`
is an ARD-layer convention (`specVersion: "1.0"`). This is an emission concern, not a schema concern —
the schema validates the document regardless of where it is served.
