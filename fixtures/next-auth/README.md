# fixture: next-auth

A minimal App Router app with `next-auth` actually installed and mounted at
`app/api/auth/[...nextauth]/route.ts` — the thin single-axis fixture for auth-provider detection.
The synthetic unit tests (`detect-auth-provider.test.ts`) cover the provider matrix; this fixture
proves the one thing they can't: the detection holding against a real dependency tree and a real
`next build`, with the report noting that next-auth signs humans in (steering gated surfaces to
the api_key lane) and the default `/api/auth/**` gating floor keeping the mount out of the catalog.

**Exercises:** package.json auth-provider detection (next-auth), the human-sign-in-only report
note, and the built-in `/api/auth/**` gating floor — all through the golden-report layer.
