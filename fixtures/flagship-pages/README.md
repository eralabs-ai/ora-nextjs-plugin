# fixture: flagship-pages

The flagship app's information architecture ported wholesale to the Pages Router — the corpus's
deep-axis twin. The router model forks everything downstream (route listing, twin sourcing, 404
convention, MCP mount shape, WebMCP URL resolution), so this fixture re-proves the flagship's
composition against a Pages-only project rather than isolating one behavior per fixture.

What differs from flagship, deliberately:

- **Routes live under `pages/`** — `/`, `/destinations`, `/destinations/[slug]`
  (getStaticPaths/getStaticProps), the booking flow, and the gated `/account`; `_app`/`_document`
  must never be listed, and `pages/404.tsx` is the Pages-Router 404 convention (`report.agent404`).
- **Both MCP servers mount as catch-all API routes** — `pages/api/[transport].ts` (gated via
  `withMcpAuth` + the stub verifier, served at `/api/mcp`) and `pages/api/public/[transport].ts`
  (open, `/api/public/mcp`), each bridging mcp-handler's Web-standard handler to `(req, res)`.
- **Declarative WebMCP on a Pages route** — the `<form toolname="watch_route">` on
  `/destinations`, proving file-is-the-route URL resolution for the Pages Router.
- **Middleware wired to ax** — the plain `withAx({ manifest })` form against a Pages-only
  manifest.
- **No MDX, sitemap, JSON-LD, or `.well-known` OAuth documents** — those are App-Router artifact
  axes already proven in flagship (the Pages Router can't serve `/.well-known/*` documents without
  rewrites); auth detection here comes from the `withMcpAuth` wrapper plus the config-declared
  entry.

**Exercises:** the Pages Router fork of the router model end-to-end — route listing and special-file
exclusion, `pages/404.tsx` detection, Pages-mounted MCP servers (gated + public, multi-card),
Pages-resolved declarative WebMCP, gating and dynamic prefixes in the serving manifest, and the
report/twin/card goldens for all of it.
