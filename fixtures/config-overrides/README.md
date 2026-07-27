# fixture: config-overrides

A Next.js app that declares catalog config in `ax.config.ts` — the Phase 2.1 config surface.

**Exercises:**

- **Config loading** — a TypeScript `ax.config.ts` (typed with `AxConfig` imported from the
  plugin) is discovered and loaded by the postbuild CLI via `jiti`.
- **Config-declared entries** — `docs` (`text/html`) and `skills` (`application/ai-skill+md`)
  pointers are emitted into the catalog. (Until Phase 2.2's zero-config detection exists, these are
  the only source of entries; the same `identifier`-matching merge will later layer config over
  _inferred_ entries.)
- **Denylist safety net + allowlist re-inclusion** — the config also declares two `/api/auth/**`
  entries, which the default-on denylist covers. `urn:example:auth-status` is re-included via the
  config's `allowlist` and survives; `urn:example:auth-internal` is not, so it's dropped from the
  emitted catalog even though it's declared. Demonstrates "precision over recall".

So the emitted catalog contains exactly three entries: `urn:example:docs`, `urn:example:skills`,
and `urn:example:auth-status` — asserted in
`packages/ax/test/fixtures-integration.test.ts`.
