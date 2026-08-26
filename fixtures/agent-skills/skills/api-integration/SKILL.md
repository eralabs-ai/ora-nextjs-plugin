---
name: api-integration
---

Helps a coding agent wire a new API route into this site and expose it to other agents correctly.

Add the route under `app/api/<name>/route.ts` using the standard Next.js Route Handler signature.
Export the HTTP methods you need (`GET`, `POST`, ...) and return a `Response` or `NextResponse`.
If the route should be gated, prefer an existing auth wrapper over hand-rolled checks so `ax` can
still describe the surface's auth posture in the published catalog.

Once the route exists, re-run the build so the catalog and any generated docs pick it up — this
skill does not publish anything on its own.
