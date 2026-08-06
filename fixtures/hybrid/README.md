# hybrid

A Next.js app with **both** an `app/` (App Router) and a `pages/` (Pages Router) directory — a
common migration state. It proves the plugin scans both routers and unions their route tables:
`/` and `/dashboard` from `app/`, `/about` from `pages/`. `/dashboard` is defined in both routers
and must appear exactly once (App Router wins the dedupe, matching Next.js runtime precedence).
