import type { AxConfig } from '@ora-ai/ax';

// A literal `siteUrl` keeps this fixture's emitted output identical everywhere it's built. The
// `isGated` matcher restates the built-in floor (inlined — see config-overrides for why the
// fixture can't import the runtime `defaultIsGated`) and gates the /private page, so the twin
// pass has a gated route to refuse.
const config: AxConfig = {
  siteUrl: 'https://markdown-twins-fixture.example.com',
  isGated: ({ path }) =>
    path.startsWith('/api/auth/') || path.startsWith('/api/webhooks/') || path === '/private',
};

export default config;
