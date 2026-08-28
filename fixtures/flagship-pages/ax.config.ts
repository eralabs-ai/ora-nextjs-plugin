import type { AxConfig } from '@ora-ai/ax-nextjs';

// The flagship app's information architecture ported to the Pages Router — same siteUrl
// convention, same gated page, same declared auth for the gated MCP mount. What differs is
// everything downstream of the router model, which is the point of this fixture.
const config: AxConfig = {
  siteUrl: 'https://flagship-pages-fixture.example.com',
  isGated: ({ path }) =>
    path.startsWith('/api/auth/') || path.startsWith('/api/webhooks/') || path === '/account',
  entries: [
    {
      identifier: 'urn:air:flagship-pages-fixture.example.com:mcp-server:api-mcp',
      auth: {
        status: 'oauth2',
        docsUrl: 'https://flagship-pages-fixture.example.com/agents.md',
      },
    },
  ],
};

export default config;
