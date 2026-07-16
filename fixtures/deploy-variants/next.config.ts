import type { NextConfig } from 'next';

// TypeScript next.config (Next 15 supports next.config.ts natively). The CLI must read this format
// too, alongside .js and .mjs. Deployment settings the CLI extracts (Phase 2.1) and that affect
// emission (Phase 2.4):
//  - `basePath` puts a static public/.well-known/ file under the prefix, not the domain root.
//  - `output: 'standalone'` does not copy public/ into the bundle unless done manually.
const nextConfig: NextConfig = {
  basePath: '/app',
  output: 'standalone',
};

export default nextConfig;
