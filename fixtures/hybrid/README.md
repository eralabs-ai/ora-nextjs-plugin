# hybrid

A Next.js app with **both** an `app/` (App Router) and a `pages/` (Pages Router) directory — a
common migration state. It proves the plugin scans both routers and unions their route tables:
`/` and `/dashboard` from `app/`, `/about` from `pages/`.

Note: each route is defined in exactly one router. Next.js refuses to build when the same route is
defined in both (a hard "Conflicting app and page file" error, not a warning), so a real hybrid app
— and this fixture — never carries a route collision. There is nothing for the plugin to "resolve";
it simply lists each route once across the two routers.
