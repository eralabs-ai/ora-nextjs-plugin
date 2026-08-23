# fixture: mcp-multi-server

A Next.js app hosting **two** MCP servers via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler):
an open one at `/api/public/mcp` and a `withMcpAuth`-gated one at `/api/mcp` — the multi-server
sibling of `mcp-adapter` / `mcp-adapter-gated`, modeled on the demo app.

**Exercises:** multi-card emission and per-card persistence.

- One server card per mount: the primary's at `/.well-known/mcp/server-card.json` (the path agent
  registries and Ora probe), and every server's card at its named
  `/.well-known/mcp/server-card/<server-name>.json` slot (`api-public-mcp.json`, `api-mcp.json`).
- The primary defaults to the **public** server on this headless (`--yes`) build; the report
  records `mcp.primaryMount` and flags `primaryUnreviewed` so an interactive build (or `ax init`)
  can confirm it. The open mount likewise stays in `unreviewedMounts` — no gating decision is on
  record for it in a fresh checkout.
- The gated mount's card carries `authentication: { required: true }` plus the RFC 9728
  `resourceMetadata` link from its `resourceMetadataPath` literal.
- Each catalog entry points at its own card: the primary's at the root path, the gated one at its
  named slot.

Ships an `ax.config.ts` declaring `siteUrl` so the emitted output is deterministic in CI.
