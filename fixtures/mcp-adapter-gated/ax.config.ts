import type { AxConfig } from '@ora-ai/ax';

// A literal `siteUrl` keeps this fixture's emitted output identical everywhere it's built (see the
// mcp-adapter fixture for the full rationale). A real app would read this from its own env var.
const config: AxConfig = {
  siteUrl: 'https://mcp-gated-fixture.example.com',
};

export default config;
