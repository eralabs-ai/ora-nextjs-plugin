import type { AxConfig } from '@ora-ai/ax-nextjs';

// `siteUrl` makes the fixture deterministic regardless of where it's built (see the mcp-adapter
// fixture for the full rationale) — without it, declarative WebMCP detection would still run but
// skip emitting the URL-bearing page entry.
const config: AxConfig = {
  siteUrl: 'https://webmcp-fixture.example.com',
};

export default config;
