---
'@ora-ai/ax': minor
---

Add Phase 2.1: `ax.config.*` (denylist/allowlist with a default-on
`/api/auth/**`+`/api/webhooks/**` denylist, and hand-declared entries that override/extend
inferred ones by `identifier`) and `next.config.*` reading (`basePath`/`distDir`/`output`,
object or function form). An invalid `ax.config` fails the build loudly; a `next.config` that
fails to load only warns and falls back to defaults.

The config file is named `ax.config`, after the `ax` tool that reads it. (It was called
`ard.config` during development; that name is still accepted, with a deprecation warning, and
`ax.config` wins if both are present.)

**Breaking (pre-1.0):** `generateCatalog` and `runCli` are now `async`, since loading config files
can only happen asynchronously. Callers must `await` them.
