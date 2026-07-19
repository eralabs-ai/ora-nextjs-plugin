# ora-nextjs-plugin

Generates a spec-valid [`ai-catalog.json`](https://github.com/Agent-Card/ai-catalog) (Agentic
Resource Discovery / AI Catalog) from a Next.js app at build time, so agents and registries can
discover the site's capabilities.

> **Status:** pre-release, under active development. See [`PLAN.md`](./PLAN.md) for the phased
> roadmap. This repo currently implements Phase 0 groundwork (spec + validator, workspace, fixture
> corpus), the Phase 1 walking skeleton (CLI that emits a minimal, spec-valid, site-metadata-only
> catalog as a `postbuild` step), and Phase 2.1 (config: `ora-catalog.config.*`, `next.config.*`
> reading, denylist/allowlist, entry overrides). Zero-config artifact detection (MCP, OpenAPI,
> docs/skills, llms.txt — Phase 2.2) is next. Deploying a fixture to Vercel and running it through
> Ora's AgentJourney is also still pending — see `PLAN.md` Phase 1.

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

## Usage

Add `ora-catalog` as a dependency and run it as a `postbuild` step:

```sh
npm install --save-dev ora-catalog
```

```json
{
  "scripts": {
    "build": "next build",
    "postbuild": "ora-catalog"
  }
}
```

This writes `public/.well-known/ai-catalog.json` with site-level metadata (`displayName` /
`description` from `package.json`) plus any entries you declare in `ora-catalog.config` — validated
against the AI Catalog spec before it's written; the CLI refuses to write (and exits non-zero) if
generation ever produces an invalid catalog. Zero-config artifact _detection_ (MCP servers,
`openapi.json`, `llms.txt`, docs/skills) lands in Phase 2.2 — see `PLAN.md`.

### Config (`ora-catalog.config.{ts,js,mjs,cjs}`)

Optional. Loaded from your project root; `.ts`/`.mjs`/`.cjs`/`.js` all work.

```ts
import type { OraCatalogConfig } from 'ora-catalog';

const config: OraCatalogConfig = {
  // Glob patterns that must never be published, even once zero-config detection (Phase 2.2)
  // would otherwise infer an entry for them. `/api/auth/**` and `/api/webhooks/**` are denied
  // by default; list them again here only if you also want an `allowlist` exception below.
  denylist: ['/internal/**'],
  // Re-include a path the denylist would otherwise exclude.
  allowlist: ['/api/auth/status'],
  // Hand-declared entries. An `identifier` matching an inferred entry overrides/extends it
  // field-by-field (never replaces it outright); anything else is appended as a new entry.
  entries: [{ identifier: 'urn:example:docs', type: 'text/html', url: '/docs' }],
};

export default config;
```

An invalid config (unknown top-level key, wrong field type, ...) fails the build loudly with a
specific, actionable message — it is never silently ignored or partially applied.

### `next.config` reading

The CLI reads your `next.config.{ts,js,mjs,cjs}` (object or function form) to extract `basePath`,
`distDir`, and `output`, so you never repeat them in `ora-catalog.config`. Unlike the plugin's own
config above, a `next.config` that fails to load only warns and falls back to defaults — it's not
this plugin's place to fail your build over your Next.js config.

**Known limitation:** if your app sets `basePath`, the static file above is served under that
prefix (e.g. `/app/.well-known/ai-catalog.json`), not at the domain root crawlers expect — the CLI
warns about this on every build. A route-handler emission target that isn't affected by `basePath`
is planned for Phase 2.4.

## Development

Requires Node 18.18+ and pnpm.

```sh
pnpm install
pnpm typecheck   # tsc across the workspace
pnpm test        # package unit tests (incl. the spec validator)
pnpm lint        # prettier --check
pnpm fixtures:build   # build every fixture app
```
