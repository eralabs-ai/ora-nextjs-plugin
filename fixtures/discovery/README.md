# fixture: discovery

An app that already ships the discovery/access artifacts Ora scores: a static `public/robots.txt`
(scoped AI-agent `Allow` rules plus `Sitemap:` / `Agentmap:` pointers), an idiomatic
`app/sitemap.ts`, and a `public/agents.md`.

**Exercises:** the Phase 2.4 **detect-and-recommend** path. The plugin detects all three and emits
advisory recommendations confirming they're present — it never turns them into catalog entries,
never reimplements a sitemap, and never rewrites the robots policy. With none of them present it
would instead recommend adding each (see `detect-robots` / `detect-sitemap` / `detect-agents-md`
tests). Emission stays the default static `public/.well-known/ai-catalog.json`; the alternative
route-handler target (`emit: 'route'`) is covered by `write.test.ts`.

Ships an `ard.config.ts` declaring `siteUrl` so the catalog is deterministic in CI.
