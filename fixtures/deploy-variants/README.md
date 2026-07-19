# fixture: deploy-variants

`basePath: '/app'` and `output: 'standalone'` — the deployment settings the CLI must read out of
`next.config` (Phase 2.1) and account for when emitting.

**Exercises:**

- **Phase 1 limitation (verified 2026-07-19):** `ora-catalog`'s postbuild step writes
  `public/.well-known/ai-catalog.json` unconditionally — it does not yet read `next.config` (that's
  Phase 2.1). With `basePath: '/app'` set, Next.js serves that static file **only** under the
  basePath prefix. Confirmed empirically against this fixture (`next dev`):
  - `GET /app/.well-known/ai-catalog.json` → `200`
  - `GET /.well-known/ai-catalog.json` → `404`

  Crawlers (and the `.well-known` convention itself) expect the domain-root path, so **any site
  with a `basePath` gets an ai-catalog that is unreachable at the conventional URL in Phase 1.**
  The fix is the route-handler emission target (Phase 2.4), which can be mounted to respond at the
  true root regardless of `basePath`. Until then, `basePath` apps are a known, documented gap — not
  a silent failure: the CLI should warn about it once it reads `next.config` in Phase 2.1.

- **`output: 'standalone'` (verified 2026-07-19):** the standalone build (`.next/standalone/`)
  contains no `public/` directory at all — Next.js's own documented behavior is that `standalone`
  copies only the server and traced `node_modules`, and expects the deployer to copy `public/` and
  `.next/static/` in manually for self-hosting (e.g. Docker). So a self-hosted standalone deployment
  needs an explicit copy step for the generated catalog to be served; Vercel's own build pipeline
  (the Phase 1 deploy target) handles static assets separately from the standalone server output, so
  this specifically bites **self-hosted** `standalone` deployments, not Vercel.
- next-config reading must survive a non-trivial config (object form, multiple keys).
