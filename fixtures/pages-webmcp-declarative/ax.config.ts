import type { AxConfig } from '@ora-ai/ax-nextjs';

// `siteUrl` makes the fixture deterministic (see the mcp-adapter fixture for the full rationale).
// This is a Pages Router app: the declarative `<form toolname>` lives on `pages/index.tsx`, whose
// URL the plugin resolves via the Pages Router file-is-the-route rule (not the App Router `page.tsx`
// convention), so it emits the same `text/html` catalog entry it would for an App Router page.
const config: AxConfig = {
  siteUrl: 'https://pages-webmcp-fixture.example.com',
};

export default config;
