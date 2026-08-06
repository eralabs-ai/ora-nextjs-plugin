import type { AxConfig } from '@ora-ai/ax';

// `siteUrl` makes the fixture deterministic (see the mcp-adapter fixture for the full rationale).
// This app has BOTH an `app/` and a `pages/` directory (a common migration state). The plugin scans
// both and unions their routes: `/` and `/dashboard` come from the App Router, `/about` from the
// Pages Router. `/dashboard` is defined by both routers — it appears once (App Router wins the
// dedupe, matching Next.js's runtime precedence).
const config: AxConfig = {
  siteUrl: 'https://hybrid-fixture.example.com',
};

export default config;
