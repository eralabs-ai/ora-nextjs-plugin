---
'@ora-ai/ax': minor
---

Add Phase 2.1: `ard.config.*` (denylist/allowlist with a default-on
`/api/auth/**`+`/api/webhooks/**` denylist, and hand-declared entries that override/extend
inferred ones by `identifier`) and `next.config.*` reading (`basePath`/`distDir`/`output`,
object or function form). An invalid `ard.config` fails the build loudly; a `next.config` that
fails to load only warns and falls back to defaults.

The config file is named `ard.config` (Agentic Resource Discovery), not after this package — it's
committed into the consumer's repo, so it stays vendor-neutral.

**Breaking (pre-1.0):** `generateCatalog` and `runCli` are now `async`, since loading config files
can only happen asynchronously. Callers must `await` them.
