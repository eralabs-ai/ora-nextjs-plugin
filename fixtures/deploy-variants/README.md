# fixture: deploy-variants

`basePath: '/app'` and `output: 'standalone'` — the deployment settings the CLI reads out of
`next.config` (Phase 2.1) and accounts for when emitting.

**Exercises:**

- **Known gap, now warned-about (Phase 2.1, verified 2026-07-19):** `ax`'s postbuild step
  still writes `public/.well-known/ai-catalog.json` unconditionally regardless of `basePath` — the
  fix is the route-handler emission target (Phase 2.4). But as of Phase 2.1 the CLI _does_ read
  `next.config` (`loadNextConfig`) and prints a build warning when it sees `basePath` set, since
  Next.js serves that static file **only** under the basePath prefix. Confirmed empirically against
  this fixture (`next dev`):
  - `GET /app/.well-known/ai-catalog.json` → `200`
  - `GET /.well-known/ai-catalog.json` → `404`

  Crawlers (and the `.well-known` convention itself) expect the domain-root path, so **any site
  with a `basePath` gets an ai-catalog that is unreachable at the conventional URL** until Phase
  2.4 lands the route-handler emission target, which can be mounted to respond at the true root
  regardless of `basePath`.

- **`output: 'standalone'` (verified 2026-07-19):** the standalone build (`.next/standalone/`)
  contains no `public/` directory at all — Next.js's own documented behavior is that `standalone`
  copies only the server and traced `node_modules`, and expects the deployer to copy `public/` and
  `.next/static/` in manually for self-hosting (e.g. Docker). So a self-hosted standalone deployment
  needs an explicit copy step for the generated catalog to be served; Vercel's own build pipeline
  (the Phase 1 deploy target) handles static assets separately from the standalone server output, so
  this specifically bites **self-hosted** `standalone` deployments, not Vercel.
- next-config reading must survive a non-trivial config (object form, multiple keys).
