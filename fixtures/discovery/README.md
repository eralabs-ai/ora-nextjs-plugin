# fixture: discovery

An app that already ships the discovery/access artifacts Ora scores: a static `public/robots.txt`
(scoped AI-agent `Allow` rules plus `Sitemap:` / `Agentmap:` pointers), an idiomatic
`app/sitemap.ts`, a `public/agents.md`, and an Organization JSON-LD block (with a `sameAs` array) in
the root layout.

**Exercises:** the Phase 2.4 / 2.7 **detect-and-recommend** path. The plugin detects all four and
emits advisory recommendations confirming they're present — it never turns them into catalog
entries, never reimplements a sitemap, never rewrites the robots policy, and never authors the
JSON-LD. With none of them present it would instead recommend adding each (see `detect-robots` /
`detect-sitemap` / `detect-agents-md` / `detect-json-ld` tests). Emission stays the default static
`public/.well-known/ai-catalog.json`; the alternative route-handler target (`emit: 'route'`) is
covered by `write.test.ts`.

Ships an `ard.config.ts` declaring `siteUrl` so the catalog is deterministic in CI.
