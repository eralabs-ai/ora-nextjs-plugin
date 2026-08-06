# hybrid

A Next.js app with **both** an `app/` (App Router) and a `pages/` (Pages Router) directory — a
common migration state. It proves the plugin scans both routers and unions their route tables:
`/` and `/dashboard` from `app/`, `/about` from `pages/`.

Note on the dedupe case: Next.js refuses to build when the same route is defined in both routers
(it is a hard "Conflicting app and page file" error, not a warning), so a fixture that must `next
build` cleanly cannot carry a real collision. The plugin's App-Router-wins dedupe is therefore
exercised by a synthetic unit test (`packages/ax/test/router-model.test.ts`) rather than here.
