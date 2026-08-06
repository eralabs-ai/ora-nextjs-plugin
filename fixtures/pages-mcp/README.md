# pages-mcp

A **Pages Router** app whose MCP server is mounted at `pages/api/[transport].ts`. It proves the
plugin detects an `mcp-handler` mount in the Pages Router `pages/api/**` shape (not just the App
Router `route.ts` shape) and resolves the `[transport]` convention to `/api/mcp`.
