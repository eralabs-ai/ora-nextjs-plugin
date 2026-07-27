# fixture: mcp-adapter

A Next.js app that already hosts an MCP server via
[`mcp-handler`](https://www.npmjs.com/package/mcp-handler).

> **Package note:** the maintained package is `mcp-handler`; `@vercel/mcp-adapter` is now an empty
> stub. The plugin's MCP detection targets `mcp-handler` and treats `@vercel/mcp-adapter` as a legacy
> alias.

**Exercises:** zero-config MCP detection (Phase 2.2). An existing MCP mount is unambiguous intent to
publish, so the plugin surfaces the MCP server in the catalog **without** an opt-in marker — the
one exception to "route entries are opt-in only." Detection resolves the `[transport]` dynamic
segment to `/mcp` (`mcp-handler`'s documented default `streamableHttpEndpoint`) and populates
`capabilities` from the `server.tool(...)` call sites it finds.

Ships an `ax.config.ts` declaring `siteUrl` so the emitted entry's URL is deterministic in CI
(without it, this detector still runs, but skips emitting a URL-bearing entry since none of this
repo's test environments set Vercel's production-domain env var).
