# fixture: monorepo

A Turborepo with the Next.js app nested one level down at `apps/web` (marked by `turbo.json`).

**Exercises:** monorepo support, which for v1 is **detect-and-warn** (see the support matrix). The CLI
must find `apps/web/next.config` from a nested location rather than assuming the app is at the repo
root. Full nested-workspace resolution is out of scope for v1.
