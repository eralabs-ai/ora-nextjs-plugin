import type { AxConfig } from '@ora-ai/ax';

// `siteUrl` makes the fixture deterministic (see the mcp-adapter fixture for the full rationale).
// This app has BOTH an `app/` and a `pages/` directory (a common incremental-migration state). The
// plugin scans both and unions their routes: `/` and `/dashboard` come from the App Router, `/about`
// from the Pages Router. Each route is defined in exactly one router — Next.js hard-errors if the
// same route is defined in both — so the plugin simply lists each route once across the two.
const config: AxConfig = {
  siteUrl: 'https://hybrid-fixture.example.com',
};

export default config;
