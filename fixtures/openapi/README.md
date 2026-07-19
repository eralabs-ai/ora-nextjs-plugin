# fixture: openapi

An app that already serves an OpenAPI 3.1 document at `public/openapi.json`.

**Exercises:** the **detect-and-reference** path (Phase 2.2). The plugin finds the served
`openapi.json`, confirms it parses as OpenAPI 3.x, and emits **one** catalog entry of
`type: application/vnd.oai.openapi+json;version=3.1` pointing at `/openapi.json` — the shape Telnyx
(Ora's top-ranked A+ site) publishes. It must **not** regenerate or fan the API out into per-route
entries.

Ships an `ard.config.ts` declaring `siteUrl` so the emitted entry's URL is deterministic in CI
(without it, this detector still runs, but skips emitting a URL-bearing entry since none of this
repo's test environments set Vercel's production-domain env var).
