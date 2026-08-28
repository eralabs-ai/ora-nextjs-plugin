# `@ora-ai/ax` — Agent Experience for Next.js

The web was built for humans. Now a new era begins: AI agents that browse, read, and act on a
site's behalf — and most sites are invisible to them: no map, no context, no way in.

`@ora-ai/ax` is the agent-experience toolkit for Next.js: a build step that generates and
publishes your agent-facing artifacts, and an edge middleware that serves agents at runtime.

## One-time setup

```sh
npm install @ora-ai/ax   # or: pnpm add @ora-ai/ax · yarn add @ora-ai/ax
```

```sh
npx ax init
```

That's it. From now on, every build generates your agent-friendly artifacts automatically.

## What ax does

**Teach agents how to use your website — `agents.md`**
ax detects an existing `agents.md` and recommends adding one when it's missing. Writing the content
is a job for a docs-authoring skill, not the build — ax never writes it for you.

**Make your site readable to agents — markdown twins**
Every static page gets a `.md` twin (`/docs` → `/docs.md`), generated from your real build output or
a markdown source, and kept in sync on every build.

**Help agents navigate your website — AI Catalog + `llms.txt`**
A spec-valid AI Catalog at `/.well-known/ai-catalog.json` lists what your site offers; an opt-in
scaffolded `llms.txt` points agents at your key pages and machine-readable resources.

**Help agents authenticate to your website — auth detection, declared auth, `auth.md`**
ax detects gated MCP and OpenAPI surfaces, lets you declare the real auth flow when detection can't
see one, and publishes both in a generated `auth.md`. Your 401/403 responses stay honest — ax never
touches your route handlers.

**Steer lost agents back — `/404.md` wayfinding guide + middleware**
Every build generates `/404.md` — your real routes and discovery artifacts, for agents that hit a
dead end. Your 404 page stays yours: ax only asks it to carry one invisible
`<link rel="alternate" type="text/markdown" href="/404.md">` tag. The runtime middleware serves the
same wayfinding response directly for any URL that matches nothing.

**Tell agents who you are and gain their trust — JSON-LD scaffolding**
An opt-in `Organization` JSON-LD component is scaffolded from your `package.json`. ax prints the
exact import and element to add — it never edits your layout itself.

Detection and the catalog run automatically on every build. Everything that writes into your source
tree is opt-in, listed in `ax.config`, and never overwrites a file you already have.

## The report

With `report: true` (the wizard's default), every build writes `.ora/report.json` — a
machine-readable summary of what was generated, detected, and skipped (and why), with every finding
mapped to [Ora](https://ora.ai)'s agent-readiness checks as `addressed` or `actionable`. Point your
coding agent at it after a build and let it work through what's left.

## How it works

A regular dependency, not a dev one: `@ora-ai/ax/middleware` is imported by your `middleware.ts`
and bundled into the production build (the entry is Web-API-only with zero runtime dependencies, so
it's edge-safe). Skip the middleware and ax is build-time only — a devDependency works then too.

`ax init` wires two build hooks. `prebuild: ax manifest` builds a lightweight map of your site —
routes, gated paths, discovery artifacts — before Next.js compiles your middleware.
`postbuild: ax` uses the finished build to generate and publish the real artifacts against that map:
the catalog, markdown twins, scaffolds, and the report. At runtime, `@ora-ai/ax/middleware` reads
the same map to serve agents directly. Wiring the middleware (and any JSON-LD component) into your
app is left to you — ax prints the exact lines to add, it never edits `middleware.ts` or your layout
itself.

Welcome to the agentic web.

---

> **Status:** Pre-release, under active development. Detection, the opt-in scaffolds, the
> Ora-mapped build report, review-before-publish, and the `ax init` wizard are implemented and
> tested. Full roadmap and design rationale: [`docs-internal/PLAN.md`](./docs-internal/PLAN.md).

## Supported matrix (v1)

This matrix is a public contract from day one. Anything outside it is out of scope for v1.

| Dimension       | Supported                                           |
| --------------- | --------------------------------------------------- |
| Next.js router  | **App Router and Pages Router** (and both at once)  |
| Next.js version | 14.x, 15.x (a CI canary job is planned)             |
| Language        | **JavaScript and TypeScript** apps                  |
| Config format   | `next.config.js` / `.mjs` / `.ts`                   |
| Node.js         | 18.18+, 20 LTS, 22 LTS                              |
| Bundler         | Webpack **and** Turbopack (CLI is bundler-agnostic) |
| Monorepo        | Turborepo: **detect-and-warn** planned for v1       |

## `ax init`

Rather than hand-write `ax.config` and wire the build yourself, run the onboarding wizard:

```sh
npx ax init
```

It detects your surfaces from source (no build needed), asks only what code can't answer — your
production `siteUrl`, which surfaces agents can use without signing in, how agents authenticate to
the gated ones — and writes a documented `ax.config.ts`, adding `"postbuild": "ax"` and
`"prebuild": "ax manifest"` to `package.json`. It never overwrites an existing script or config;
where one already exists, it prints the exact edit to make instead.

For CI, run it unattended:

```sh
npx ax init --yes --site-url https://yourdomain.com
```

`--yes` accepts every default; `siteUrl` has no default, since it's written verbatim into your
public catalog — give it via `--site-url` or a `SITE_URL` / `NEXT_PUBLIC_SITE_URL` env var.

> Scaffolds default to **off** in `ax.config`, but the wizard's checklist shows them all
> **pre-selected** — you're present and choosing, so nothing is written silently on an unattended
> build.

## Configuration (`ax.config.{ts,js,mjs,cjs}`)

Optional, loaded from your project root. Evaluated as real code (via
[`jiti`](https://github.com/unjs/jiti)), not parsed as static JSON.

```ts
import { defaultIsGated, type AxConfig } from '@ora-ai/ax';

const config: AxConfig = {
  // Your production origin. Falls back to SITE_URL / NEXT_PUBLIC_SITE_URL, then (on Vercel)
  // VERCEL_PROJECT_PRODUCTION_URL. Real code, so any env var name works:
  //   siteUrl: process.env.DEPLOY_URL
  siteUrl: 'https://example.com',
  // Where to write the catalog: 'static' (default) writes public/.well-known/ai-catalog.json;
  // 'route' writes an App Router handler instead.
  emit: 'static',
  // Scaffold a starter llms.txt filled with your real routes and artifacts. Opt-in.
  scaffoldLlmsTxt: true,
  // Add Sitemap:/Agentmap: discovery lines to robots.txt (or write one if you have none). Opt-in.
  scaffoldRobots: true,
  // Scaffold an Organization JSON-LD component. Opt-in; ax never wires it into your layout.
  scaffoldJsonLd: true,
  // Generate markdown twins of your pages, /auth.md when surfaces are gated, and the /404.md
  // wayfinding guide lost agents continue from. Default on.
  markdownTwins: true,
  // Write .ora/report.json, the machine-readable build report. Opt-in.
  report: true,
  // Mark an artifact as gated behind auth so it's never advertised as open. Compose
  // defaultIsGated to extend the built-in floor (which gates /api/auth/** and /api/webhooks/**)
  // rather than replace it:
  isGated: (target) => defaultIsGated(target) && target.path !== '/api/auth/status',
  // Hand-declared entries zero-config detection can't guess at, e.g. docs/skills pointers.
  entries: [
    { identifier: 'urn:example:docs', type: 'text/html', url: 'https://example.com/docs' },
    // Declare the real auth flow when detection can only see "requires auth, scheme unknown"
    // (e.g. a withMcpAuth-wrapped MCP mount). Flows to the catalog, the server card, and /auth.md.
    {
      identifier: 'urn:air:example.com:mcp-server',
      auth: {
        status: 'oauth2',
        oauth: {
          authorizationEndpoint: 'https://auth.example.com/authorize',
          tokenEndpoint: 'https://auth.example.com/token',
        },
        docsUrl: 'https://example.com/docs/auth',
      },
    },
  ],
};

export default config;
```

An invalid config (unknown key, wrong field type, ...) fails the build loudly with a specific,
actionable message.

## Repository layout

```
packages/ax            the plugin / CLI (`@ora-ai/ax`) — the npm package (3 runtime deps: ajv, ajv-formats, jiti)
spec/                  vendored AI Catalog spec + hand-written JSON Schema + validator oracle
fixtures/*             real Next.js apps — the flagship (a full demo-app fork) + single-axis fixtures; the test suite, docs examples, and eval corpus
```
