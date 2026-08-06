import type { AxConfig } from '@ora-ai/ax';

// `siteUrl` makes the fixture deterministic regardless of where it's built (see the mcp-adapter
// fixture for the full rationale). This is a Pages Router app — no `app/` directory — so it exists
// to prove the plugin lists Pages Router routes and never mistakes `_app`/`_document`/`404`/dynamic
// files for content pages.
const config: AxConfig = {
  siteUrl: 'https://pages-bare-fixture.example.com',
};

export default config;
