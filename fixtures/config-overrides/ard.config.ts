import type { ArdConfig } from 'ora-catalog';

// This is the fixture that documents-and-tests the Phase 2.1 config surface. Until zero-config
// artifact detection lands (Phase 2.2) there are no *inferred* entries to override, so here every
// entry is config-declared; the same `identifier`-matching merge will layer these over inferred
// entries once 2.2 exists.
const config: ArdConfig = {
  // Re-include one route that the default denylist (`/api/auth/**`) would otherwise exclude —
  // this app deliberately publishes its public auth-status endpoint.
  allowlist: ['/api/auth/status'],
  entries: [
    // Ordinary docs/skills pointers — absolute URLs, so they're spec-valid on their own (the
    // catalog schema requires `url` to be an absolute URI).
    {
      identifier: 'urn:example:docs',
      type: 'text/html',
      displayName: 'API documentation',
      url: 'https://example.com/docs',
    },
    {
      identifier: 'urn:example:skills',
      type: 'application/ai-skill+md',
      displayName: 'Agent skills',
      url: 'https://github.com/example/agent-skills',
    },
    // Under the default denylist (`/api/auth/**`) but re-included by the `allowlist` above, so it
    // survives into the catalog.
    {
      identifier: 'urn:example:auth-status',
      type: 'text/html',
      url: 'https://example.com/api/auth/status',
    },
    // Under the default denylist and NOT allowlisted — the safety net drops it from the catalog,
    // even though it's declared here. Demonstrates "precision over recall".
    {
      identifier: 'urn:example:auth-internal',
      type: 'text/html',
      url: 'https://example.com/api/auth/internal',
    },
  ],
};

export default config;
