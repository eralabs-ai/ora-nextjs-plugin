# ora-nextjs-plugin

Generates a spec-valid [`ai-catalog.json`](https://github.com/Agent-Card/ai-catalog) (Agentic
Resource Discovery / AI Catalog) from a Next.js app at build time, so agents and registries can
discover the site's capabilities.

> **Status:** pre-release, under active development. See [`PLAN.md`](./PLAN.md) for the phased
> roadmap. This repo currently implements Phase 0 groundwork (spec + validator, workspace, fixture
> corpus).

## Design posture

**Spec follower, never spec inventor.** The plugin translates code developers already wrote into
whatever shape the spec defines. **Precision over recall** — a wrong or dangerous catalog entry is
worse than a missing one, so route-level tool entries are explicit opt-in and zero-config publishes
only what is unambiguous.

## Supported matrix (v1)

This matrix is a public contract from day one. Anything outside it is out of scope for v1.

| Dimension       | Supported                                           | Out of scope for v1              |
| --------------- | --------------------------------------------------- | -------------------------------- |
| Next.js router  | **App Router**                                      | Pages Router                     |
| Next.js version | 14.x, 15.x (`canary` tracked by a CI canary job)    | < 14                             |
| Language        | **JavaScript and TypeScript** apps                  | —                                |
| Config format   | `next.config.js` / `.mjs` / `.ts`                   | —                                |
| Node.js         | 18.18+, 20 LTS, 22 LTS                              | < 18.18                          |
| Bundler         | Webpack **and** Turbopack (CLI is bundler-agnostic) | —                                |
| Monorepo        | Turborepo: **detect-and-warn** for v1               | Full nested-workspace resolution |

> Some matrix rows (Pages Router exclusion, monorepo support level) are pending final confirmation
> with Ora — see the open-questions table in `PLAN.md`.

## Repository layout

```
packages/ora-catalog   the plugin / CLI (published to npm; near-zero runtime deps)
spec/                  vendored AI Catalog spec + hand-written JSON Schema + validator oracle
fixtures/*             minimal-but-real Next.js apps — the test suite, docs examples, and eval corpus
```

## Development

Requires Node 18.18+ and pnpm.

```sh
pnpm install
pnpm typecheck   # tsc across the workspace
pnpm test        # package unit tests (incl. the spec validator)
pnpm lint        # prettier --check
pnpm fixtures:build   # build every fixture app
```
