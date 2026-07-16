# fixture: mcp-adapter

A Next.js app that already hosts an MCP server via
[`mcp-handler`](https://www.npmjs.com/package/mcp-handler).

> **Package note:** the maintained package is `mcp-handler`; `@vercel/mcp-adapter` is now an empty
> stub. The plugin's MCP detection targets `mcp-handler` and treats `@vercel/mcp-adapter` as a legacy
> alias.

**Exercises:** zero-config MCP detection (Phase 2.2). An existing MCP mount is unambiguous intent to
publish, so the plugin should surface the MCP server in the catalog **without** an opt-in marker —
the one exception to "route entries are opt-in only."
