# fixture: config-overrides

A Next.js app that declares catalog config in `ax.config.ts` — the config surface.

**Exercises:**

- **Config loading** — a TypeScript `ax.config.ts` (typed with `AxConfig` imported from the
  plugin) is discovered and loaded by the postbuild CLI via `jiti`.
- **Config-declared entries** — `docs` (`text/html`) and `skills` (`application/ai-skill+md`)
  pointers are emitted into the catalog. (Until zero-config detection applies, these are the only
  source of entries; the same `identifier`-matching merge layers config over _inferred_ entries.)
- **`isGated` safety net + re-inclusion** — the config also declares two `/api/auth/**` entries,
  which the built-in gating floor covers. The config's `isGated` composes `defaultIsGated` with a
  re-inclusion: `urn:example:auth-status` is un-gated (the matcher returns `false` for it) and
  survives; `urn:example:auth-internal` stays gated, and since a plain `text/html` pointer has no
  derivable auth descriptor, ax drops it from the emitted catalog even though it's declared.
  Demonstrates "precision over recall" and the `isGated` replacement for the old denylist/allowlist.

So the emitted catalog contains exactly three entries: `urn:example:docs`, `urn:example:skills`,
and `urn:example:auth-status` — asserted in
`packages/ax/test/fixtures-integration.test.ts`.
