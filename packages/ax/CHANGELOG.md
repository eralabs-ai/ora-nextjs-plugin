# @ora-ai/ax-nextjs

## 0.1.0-canary.0

### Minor Changes

- 13614cd: **Breaking (pre-1.0):** removed support for the legacy `ard.config.*` config file and its
  deprecated `Ard*` aliases (`ArdConfig`, `ArdEntryOverride`, `ResolvedArdConfig`, `ArdConfigError`,
  `loadArdConfig`, `validateArdConfig`, `ardConfigSchema`). `ard.config.*` was `ax.config.*`'s
  pre-2026-07-27 name, kept only as a temporary migration aid; carrying a second config surface (and
  its dual-file precedence/warning logic) indefinitely cost more than the one-line rename it covered
  for.

  Migration: rename `ard.config.*` to `ax.config.*`. A project that still has only an `ard.config.*`
  now fails the build loudly — `loadAxConfig` throws `AxConfigError` naming the file and the rename —
  rather than silently building with defaults and dropping the file's settings. A project with both
  files is unaffected: `ax.config.*` already won and the `ard.config.*` was already ignored.

- 8d22b67: Add Phase 2.1: `ax.config.*` (denylist/allowlist with a default-on
  `/api/auth/**`+`/api/webhooks/**` denylist, and hand-declared entries that override/extend
  inferred ones by `identifier`) and `next.config.*` reading (`basePath`/`distDir`/`output`,
  object or function form). An invalid `ax.config` fails the build loudly; a `next.config` that
  fails to load only warns and falls back to defaults.

  The config file is named `ax.config`, after the `ax` tool that reads it. (It was called
  `ard.config` during development; that name is still accepted, with a deprecation warning, and
  `ax.config` wins if both are present.)

  **Breaking (pre-1.0):** `generateCatalog` and `runCli` are now `async`, since loading config files
  can only happen asynchronously. Callers must `await` them.

- 2b7c745: Add Phase 2.8: gating & auth. ax now reads each artifact's own auth declaration and emits a
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
