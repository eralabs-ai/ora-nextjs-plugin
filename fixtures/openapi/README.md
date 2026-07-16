# fixture: openapi

An app that already serves an OpenAPI 3.1 document at `public/openapi.json`.

**Exercises:** the **detect-and-reference** path (Phase 2.2). The plugin should find the served
`openapi.json`, confirm it parses, and emit **one** catalog entry of
`type: application/vnd.oai.openapi+json;version=3.1` pointing at `/openapi.json` — the shape Telnyx
(Ora's top-ranked A+ site) publishes. It must **not** regenerate or fan the API out into per-route
entries.
