# fixture: llms-txt

An app that serves an [`llms.txt`](https://llmstxt.org/) the recommended Next.js way — a route handler
at `app/llms.txt/route.ts` with `dynamic = 'force-static'`, so `/llms.txt` is prerendered at build. (A
static `public/llms.txt` is the other supported form.)

**Exercises:** detect-and-reference of a **confirmed-ingested** artifact — Ora's crawler ingests
`llms.txt` directly. The plugin references `/llms.txt` as a `text/markdown` entry, whether it's served
from a route or a static file. Scaffolding a starter when absent is in-scope for v1 (see `PLAN.md`).
