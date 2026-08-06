---
'@ora-ai/ax': minor
---

Add Phase 2.8: gating & auth. ax now reads each artifact's own auth declaration and emits a
secret-free `auth` descriptor (`status: 'oauth2' | 'api_key' | 'none' | 'unknown'`, plus OAuth
endpoints/scope-keys) so a gated surface is never advertised as open — the exact shape Ora's
registry projects and re-validates. OpenAPI auth is derived from `components.securitySchemes`; an
MCP mount wrapped in `withMcpAuth`/`verifyToken` is marked gated (`status: 'unknown'`, since the
OAuth endpoints aren't statically derivable) and its `resourceMetadataPath` is cross-linked on the
MCP server card. Only structural facts cross — endpoint URLs are http(s)-guarded and lists capped,
never a secret or prose.

New **`isGated`** config — a `(target) => boolean` matcher that supersedes the old
`denylist`/`allowlist`. A gated artifact ax can describe is published with its `auth` descriptor; one
it can't describe is dropped. With no `isGated`, a built-in floor gates `/api/auth/**` and
`/api/webhooks/**` (exported as `defaultIsGated`); supplying `isGated` replaces that floor wholesale,
so compose `defaultIsGated` to keep it (and return `false` to re-include a path — the job the old
`allowlist` did).

Also adds **review-before-publish** (Phase 2.3): the first publish of a catalog prints the surface
it is about to expose and is gated behind confirmation — `--yes` (required in CI / non-interactive
shells) or an interactive prompt. A re-run over an already-written catalog stays unattended. New
`--dry-run` prints the summary and writes nothing.

**Breaking (pre-1.0):** `ax.config`'s `denylist` and `allowlist` are removed in favor of `isGated`;
migrate `allowlist: ['/x']` to an `isGated` that returns `false` for `/x`, composing `defaultIsGated`
to keep the auth/webhook floor. The exports `DEFAULT_DENYLIST`, `isPathDenied` are removed
(`DEFAULT_GATED_GLOBS`, `defaultIsGated`, `resolveGating`, `matchesAnyGlob` replace them). CI
postbuild scripts must pass `ax --yes` to write a first-time catalog.
