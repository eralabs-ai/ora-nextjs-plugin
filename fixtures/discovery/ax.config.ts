import type { AxConfig } from '@ora-ai/ax-nextjs';

// `siteUrl` keeps the fixture deterministic regardless of where it's built (see the openapi
// fixture's config for the full rationale). This fixture exercises the Phase 2.4 detect-and-recommend
// artifacts (robots.txt / sitemap / agents.md), which don't need siteUrl themselves — but the emitted
// catalog's host.identifier and any future URL-bearing entry do.
const config: AxConfig = {
  siteUrl: 'https://discovery-fixture.example.com',
};

export default config;
