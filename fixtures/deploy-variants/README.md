# fixture: deploy-variants

`basePath: '/app'` and `output: 'standalone'` — the deployment settings the CLI must read out of
`next.config` (Phase 2.1) and account for when emitting.

**Exercises:**

- **Phase 1 limitation:** with a `basePath`, a static `public/.well-known/ai-catalog.json` is served
  under `/app/.well-known/...`, not at the domain root where crawlers look. Document the limitation
  now; the route-handler emission target (Phase 2.4) is the fix.
- next-config reading must survive a non-trivial config (object form, multiple keys).
