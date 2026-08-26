# fixture: middleware

An App Router app that actually wires the `@ora-ai/ax-nextjs/middleware` runtime entry — the negotiation
half of the markdown story — and proves it against a real `next build` (the Edge bundle compiles)
plus a `next start` dual-fetch dogfood (`scripts/dogfood-middleware.mjs`).

The wiring under test:

- `"prebuild": "ax manifest"` regenerates `ax-manifest.ts` (gitignored build output) before
  `next build` compiles the `middleware.ts` that imports it — the ordering the manifest exists for.
- `middleware.ts` is the exact three-line wiring the CLI recommends: `withAx({ manifest })` plus
  the pasted matcher literal.

Routes, one per negotiation branch:

- `/docs` — twin is the committed, hand-authored `public/docs.md`, so the first build's manifest
  already lists it: agents / `Accept: text/markdown` get **rewritten to the twin** (with
  `Vary: Accept` + the canonical Link), browsers and Googlebot get HTML.
- `/` — prerendered page whose twin is **generated postbuild** (golden under `twins.golden/`);
  the first-build manifest doesn't list it yet (documented one-build staleness), so dogfood probes
  never target it.
- `/shell` — a JS-shell page the twin pass permanently refuses: **real route, no twin → agents
  fall through to HTML** (never an invented markdown representation).
- `/private` — gated via `ax.config` `isGated`: in `gatedPaths`, so the middleware **falls through
  untouched** for agents too — the app's auth answer stays the honest one.
- `/blog/[slug]` — dynamic: the manifest records the `/blog` prefix and the middleware **never
  claims "not found"** under it (any slug renders here).
- Any other URL from a detected agent → **200 `text/markdown` wayfinding body** rendered from the
  manifest; plain clients keep the honest 404.

**Exercises:** the `./middleware` package export compiling in Next's Edge runtime, manifest-driven
rewrites/gating/dynamic-prefix fall-through, the response-header invariants, and the report/twin
goldens for a fixture that wires the middleware (its `markdown-negotiation` checks read
`addressed`).
