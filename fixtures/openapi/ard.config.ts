import type { ArdConfig } from '@ora-ai/ax';

// `siteUrl` makes the fixture deterministic regardless of where it's built (CI, a laptop, ...) —
// without it, zero-config OpenAPI detection (Phase 2.2) would still run but skip emitting a
// URL-bearing entry, since none of this repo's test environments set Vercel's production-domain
// env var. A real deployment on Vercel wouldn't need this line.
//
// An app hosted somewhere other than Vercel would typically read this from its own env var
// instead of a literal — this file is evaluated as real code (via jiti), so
// `siteUrl: process.env.SITE_URL` works with no special support from the plugin. It's a literal
// here only so this fixture's expected output is identical everywhere it's built, regardless of
// what env vars happen to be set.
const config: ArdConfig = {
  siteUrl: 'https://openapi-fixture.example.com',
};

export default config;
