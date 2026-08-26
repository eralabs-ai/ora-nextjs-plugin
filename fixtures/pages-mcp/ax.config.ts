import type { AxConfig } from '@ora-ai/ax-nextjs';

// `siteUrl` makes the fixture deterministic (see the mcp-adapter fixture for the full rationale).
// This is a Pages Router app whose MCP server is mounted at `pages/api/[transport].ts` — the plugin
// detects it the same way it detects an App Router `app/[transport]/route.ts` mount, resolving the
// mcp-handler `[transport]` convention to `/api/mcp`.
const config: AxConfig = {
  siteUrl: 'https://pages-mcp-fixture.example.com',
};

export default config;
