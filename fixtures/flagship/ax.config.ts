import type { AxConfig } from '@ora-ai/ax';

// A literal `siteUrl` keeps this fixture's emitted output identical everywhere it's built. The
// `isGated` matcher restates the built-in floor (inlined — see the runtime default's rationale)
// and gates /account, so the serving manifest has a gated page the middleware never touches.
// llms.txt, JSON-LD, and robots.txt all exist as hand-owned sources here, so the scaffold flags
// stay at their defaults except `scaffoldRobots`. The committed robots.txt already carries the
// marked ax block, so an in-tree build is a no-op (the marker-detection idempotence path) and the
// tree stays clean; the raw append runs in the mutation harness, which strips the block first.
const config: AxConfig = {
  siteUrl: 'https://flagship-fixture.example.com',
  scaffoldRobots: true,
  isGated: ({ path }) =>
    path.startsWith('/api/auth/') || path.startsWith('/api/webhooks/') || path === '/account',
  // The gated MCP server authenticates via OAuth (the stub .well-known documents under
  // app/.well-known/); declaring it here publishes that answer to the catalog entry, the server
  // card, and the generated /auth.md — the declared-override path of entry auth resolution.
  entries: [
    {
      identifier: 'urn:air:flagship-fixture.example.com:mcp-server:api-mcp',
      auth: {
        status: 'oauth2',
        docsUrl: 'https://flagship-fixture.example.com/agents.md',
      },
    },
  ],
};

export default config;
