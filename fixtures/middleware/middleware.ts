import { withAx } from '@ora-ai/ax/middleware';

import { axManifest } from './ax-manifest';

// The exact wiring ax's CLI prints: the generated manifest is the rewrite contract (never rewrite
// blind, never touch gated paths), and the matcher is pasted as a literal because Next.js only
// accepts a statically analyzable `config`.
export default withAx({ manifest: axManifest });

export const config = {
  matcher: ['/((?!_next|api|.*\\..*|favicon|robots|health|status).*)'],
};
