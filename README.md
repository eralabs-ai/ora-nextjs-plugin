# ora-nextjs-plugin

Generates a spec-valid [`ai-catalog.json`](https://github.com/Agent-Card/ai-catalog) (Agentic
Resource Discovery / AI Catalog) from a Next.js app at build time, so agents and registries can
discover the site's capabilities.

> **Status:** pre-release, under active development. See [`PLAN.md`](./PLAN.md) for the phased
> roadmap. This repo currently implements Phase 0 groundwork (spec + validator, workspace, fixture
> corpus), the Phase 1 walking skeleton (CLI that emits a minimal, spec-valid, site-metadata-only
> catalog as a `postbuild` step), Phase 2.1 (config: `ard.config.*`, `next.config.*` reading,
> denylist/allowlist, entry overrides), and Phase 2.2 (zero-config artifact detection: MCP servers,
> `public/openapi.json`, `llms.txt`, config-declared docs/skills). Deploying a fixture to Vercel and
> running it through Ora's AgentJourney is still pending — see `PLAN.md` Phase 1.

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

This writes `public/.well-known/ai-catalog.json` with:

- **Site-level metadata** — `displayName` / `description` from `package.json`.
- **Zero-config artifact detection** (Phase 2.2) — detects and references what's already there:
  - An **MCP server** mounted via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) (or
    its legacy alias `@vercel/mcp-adapter`) → `application/mcp-server-card+json`.
  - A static **`public/openapi.json`** → `application/vnd.oai.openapi+json`.
  - An **`llms.txt`** served either as `app/llms.txt/route.ts` or `public/llms.txt` →
    `text/markdown`.
- **Config-declared entries** — anything you list in `ard.config`'s `entries`, e.g. docs/skills
  pointers (`text/html` / `application/ai-skill+md`).

Every entry above is validated against the AI Catalog spec before writing; the CLI refuses to
write (and exits non-zero) if generation ever produces an invalid catalog. The plugin only ever
**detects and references** — it never invents a per-route entry or synthesizes a doc from route
handlers (see `PLAN.md`'s _Scope_ and _Core design decisions_).

**Absolute URLs need a known site origin.** The spec requires every entry's `url` to be an
absolute URI, so a detector skips emitting its entry (with a warning) unless it can resolve one —
from `ard.config`'s `siteUrl`, or from Vercel's build-time `VERCEL_PROJECT_PRODUCTION_URL`. On any
other host, set `siteUrl` explicitly (see below).

`ard.config.*` is evaluated as real code at build time (via [`jiti`](https://github.com/unjs/jiti)),
not parsed as static JSON — so `siteUrl: process.env.SITE_URL` (or whatever env var your host/CI
sets) works with no special support needed. The plugin doesn't guess a variable name on your
behalf: unlike Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, there's no single convention for "the
site's URL" across hosts (`SITE_URL`, `NEXT_PUBLIC_SITE_URL`, `DEPLOY_URL`, ... all exist in the
wild), and guessing wrong could silently point the catalog at a stale preview URL.

### Config (`ard.config.{ts,js,mjs,cjs}`)

Optional. Loaded from your project root; `.ts`/`.mjs`/`.cjs`/`.js` all work. (Named `ard.config`
after the Agentic Resource Discovery spec rather than after this package — it's a file you commit,
so it stays vendor-neutral.)

```ts
import type { ArdConfig } from 'ora-catalog';

const config: ArdConfig = {
  // Your production origin — every detected entry's URL is resolved against this. Only needed off
  // Vercel (Vercel's own VERCEL_PROJECT_PRODUCTION_URL is used automatically when this is unset).
  // This file is real code, so reading it from your own env var works too:
  //   siteUrl: process.env.SITE_URL,
  siteUrl: 'https://example.com',
  // Scaffold a starter app/llms.txt/route.ts when neither it nor public/llms.txt exists.
  // Opt-in (defaults to false) — it writes into your source tree, not just the catalog file.
  scaffoldLlmsTxt: true,
  // Glob patterns that must never be published, even if a detector would otherwise infer an entry
  // for them. `/api/auth/**` and `/api/webhooks/**` are denied by default; list them again here
  // only if you also want an `allowlist` exception below.
  denylist: ['/internal/**'],
  // Re-include a path the denylist would otherwise exclude.
  allowlist: ['/api/auth/status'],
  // Hand-declared entries — e.g. docs/skills pointers zero-config detection can't guess at. An
  // `identifier` matching a detected entry overrides/extends it field-by-field (never replaces it
  // outright); anything else is appended as a new entry.
  entries: [{ identifier: 'urn:example:docs', type: 'text/html', url: 'https://example.com/docs' }],
};

export default config;
```

An invalid config (unknown top-level key, wrong field type, ...) fails the build loudly with a
specific, actionable message — it is never silently ignored or partially applied.

### `next.config` reading

The CLI reads your `next.config.{ts,js,mjs,cjs}` (object or function form) to extract `basePath`,
`distDir`, and `output`, so you never repeat them in `ard.config`. Unlike the plugin's own
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
