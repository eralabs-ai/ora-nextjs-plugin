# fixture: flagship

The corpus's representative app — a fork of the ora-air flight-booking demo, enriched until it
exercises most detectors in one real build. Where the other fixtures each isolate one behavior,
this one proves the behaviors compose: middleware negotiation + gating + two MCP servers +
hand-owned discovery artifacts coexisting in a single `next build`.

What it ships, and the detection path each piece exercises:

- **Pages across the twin ladder** — `/` and `/destinations` are prerendered server components
  (content twins); `/results`, `/seats`, `/checkout`, `/confirmation` are metadata-wrapped client
  pages; `/guide` is a mostly-markdown `page.mdx` (`@next/mdx` Tier-1).
- **`/destinations` twin is committed and hand-authored** (`public/destinations.md`, no
  `generated-by` marker) — ax records it as the markdown source and never overwrites it, and the
  first build's manifest already lists it, which is what the dual-fetch dogfood probes against.
- **`/destinations/[slug]`** — dynamic segment: the manifest records the `/destinations` prefix
  and the middleware never claims "not found" beneath it.
- **`/account`** — gated via `ax.config` `isGated`: in `gatedPaths`, middleware falls through
  untouched, and the gate surfaces in `/auth.md`.
- **Two `mcp-handler` servers** — `/api/public/mcp` open (`search_flights`), `/api/mcp` gated via
  `withMcpAuth` with a deterministic stub verifier (multi-server card plan, `authentication`
  block, gated-entry auth declared `oauth2` in `ax.config`).
- **OAuth discovery chain** — static RFC 9728 + RFC 8414 documents under `app/.well-known/`, so
  the 401 → protected-resource → authorization-server walk is complete without any real identity
  provider (the demo this was forked from uses Clerk; the fixture must build with zero secrets).
- **Hand-owned artifacts detected, not scaffolded** — `app/llms.txt/route.ts`, `public/agents.md`,
  `public/openapi.json`, `app/organization-json-ld.tsx` rendered from the layout, `app/sitemap.ts`,
  and a committed `robots.txt` that `scaffoldRobots: true` appends discovery pointers to
  (append-only, exercised by the idempotence mutation test).
- **Middleware wired for real** — `withAx({ manifest }, botGate)`: the composed-second-argument
  form, proven through Edge bundling by `next build` and live by `scripts/dogfood-middleware.mjs`.

**Exercises:** detector composition under one roof — the serving manifest (twins/gating/dynamic
prefixes), multi-server MCP cards, declared entry auth, detect-and-reference for every hand-owned
artifact, and the report/twin/card goldens for all of it. Also the base app for the mutation
harness (`scripts/mutation-tests.mjs`), which copies it to a tmp dir and rebuilds it after
scripted edits.

**Reviewing golden diffs:** `report.golden.json` is large because this fixture exercises most of
the corpus's detectors in one build. When a PR churns it, read the diff by section — `mcp`,
`catalog`, `auth`, `markdownTwins`, `ora.checks` — rather than as one blob; a change should touch
only the sections its feature owns.
