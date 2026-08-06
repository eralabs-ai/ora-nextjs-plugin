import { defaultIsGated, type AxConfig } from '@ora-ai/ax';

// This is the fixture that documents-and-tests the config surface. Until zero-config artifact
// detection lands there are no *inferred* entries to override, so here every entry is
// config-declared; the same `identifier`-matching merge layers these over inferred entries.
const config: AxConfig = {
  // `isGated` supersedes the old denylist/allowlist pair. Supplying it replaces the built-in floor
  // wholesale, so this restates the floor (defaultIsGated gates `/api/auth/**` and
  // `/api/webhooks/**`) and then re-includes this app's one public auth endpoint by returning
  // false for it — the job the old allowlist did. A gated entry ax can't describe (a plain
  // text/html pointer has no derivable auth descriptor) is dropped rather than published.
  isGated: (target) => defaultIsGated(target) && target.path !== '/api/auth/status',
  entries: [
    // Ordinary docs/skills pointers — absolute URLs, so they're spec-valid on their own (the
    // catalog schema requires `url` to be an absolute URI). Identifiers follow the ARD URN format
    // (`urn:air:<publisher-domain>:<name>`, spec §4.2.1) the emission gate enforces, and every
    // entry carries the `displayName` the ARD schema requires.
    {
      identifier: 'urn:air:example.com:docs',
      type: 'text/html',
      displayName: 'API documentation',
      url: 'https://example.com/docs',
    },
    {
      identifier: 'urn:air:example.com:skills',
      type: 'application/ai-skill+md',
      displayName: 'Agent skills',
      url: 'https://github.com/example/agent-skills',
    },
    // Gated by the default floor but re-included by the `isGated` matcher above, so it survives
    // into the catalog.
    {
      identifier: 'urn:air:example.com:auth-status',
      type: 'text/html',
      displayName: 'Auth status endpoint',
      url: 'https://example.com/api/auth/status',
    },
    // Gated by the default floor and NOT re-included — ax can't describe its auth, so the safety
    // net drops it from the catalog even though it's declared here. Demonstrates "precision over
    // recall".
    {
      identifier: 'urn:air:example.com:auth-internal',
      type: 'text/html',
      displayName: 'Internal auth endpoint',
      url: 'https://example.com/api/auth/internal',
    },
  ],
};

export default config;
