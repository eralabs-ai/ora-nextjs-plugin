# fixture: llms-txt

An app that serves an [`llms.txt`](https://llmstxt.org/) the recommended Next.js way — a route handler
at `app/llms.txt/route.ts` with `dynamic = 'force-static'`, so `/llms.txt` is prerendered at build. (A
static `public/llms.txt` is the other supported form.)

**Exercises:** detect-and-reference of a **confirmed-ingested** artifact — Ora's crawler ingests
`llms.txt` directly. The plugin references `/llms.txt` as a `text/markdown` entry, whether it's
served from a route or a static file. Scaffolding a starter when absent is in-scope for v1 (see
`PLAN.md`) but **opt-in** via `ard.config`'s `scaffoldLlmsTxt: true` — this fixture doesn't need it
since it already has one.

Ships an `ard.config.ts` declaring `siteUrl` so the emitted entry's URL is deterministic in CI
(without it, this detector still runs, but skips emitting a URL-bearing entry since none of this
repo's test environments set Vercel's production-domain env var).
