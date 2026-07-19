---
'ora-catalog': minor
---

Add Phase 2.1: `ora-catalog.config.*` (denylist/allowlist with a default-on
`/api/auth/**`+`/api/webhooks/**` denylist, and hand-declared entries that override/extend
inferred ones by `identifier`) and `next.config.*` reading (`basePath`/`distDir`/`output`,
object or function form). An invalid `ora-catalog.config` fails the build loudly; a `next.config`
that fails to load only warns and falls back to defaults.

**Breaking (pre-1.0):** `generateCatalog` and `runCli` are now `async` — both need to load and
evaluate config files, which can only happen asynchronously. Callers must `await` them.
