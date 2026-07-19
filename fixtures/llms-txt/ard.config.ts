import type { ArdConfig } from 'ora-catalog';

// `siteUrl` makes the fixture deterministic regardless of where it's built (CI, a laptop, ...) —
// without it, zero-config llms.txt detection (Phase 2.2) would still run but skip emitting a
// URL-bearing entry, since none of this repo's test environments set Vercel's production-domain
// env var. A real deployment on Vercel wouldn't need this line.
const config: ArdConfig = {
  siteUrl: 'https://llms-txt-fixture.example.com',
};

export default config;
