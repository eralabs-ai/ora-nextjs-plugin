# `@ora-ai/ax` — Agent Experience for Next.js

AI agents are becoming every site's newest user segment, and most sites are invisible to them.
`ax` is one `postbuild` line that makes a Next.js app **discoverable, legible, and usable by
agents**:

```sh
npm install --save-dev @ora-ai/ax
```

```json
{
  "scripts": {
    "build": "next build",
    "postbuild": "ax"
  }
}
```

**Try it locally first.** Run your build once on your machine and `ax` shows you what agents can
already do with your site, what it generated for you, and a short, ranked list of quick wins to make
your site more agent-ready — each with the exact next step to take. Like what you see? Commit the
generated catalog (it lives in `public/`, right where Next.js serves it) and every build after that
just works.

> On the first publish, `ax` shows the surface it's about to expose and asks a quick y/N — so nothing
> goes public by surprise. Automating in CI? Add `--yes` to run unattended, or `--dry-run` to preview
> anytime without writing.

One run — offline, deterministic, about a second — then:

- **Generates** a spec-valid [AI Catalog](https://github.com/Agent-Card/ai-catalog) (Agentic
  Resource Discovery) at `/.well-known/ai-catalog.json`, validated against the official ARD schema
  before a byte is written, so agents and registries can discover the site's capabilities.
- **Detects** the agent surfaces already in your code and references what's unambiguous: MCP
  servers, W3C WebMCP in-page tools (declarative and imperative), OpenAPI docs, `llms.txt`,
  `robots.txt` / sitemap / `agents.md` / JSON-LD.
- **Scaffolds (opt-in)** the mechanical parts a build tool is uniquely placed to write, from data
  it already has: an `llms.txt` filled with your real routes and artifacts, an agent-aware 404
  page carrying your real route table, `robots.txt` discovery pointers, an `Organization` JSON-LD
  component.
- **Hands off the judgment work**: `.ora/report.json` maps every finding to [Ora](https://ora.ai)'s
  agent-readiness checks (`addressed` / `actionable`) and points your coding agent at Ora's live
  skill server — fix, scan, rescan until the site is agent-ready.

```
[ax] ✓ wrote public/.well-known/ai-catalog.json
[ax] ⚠ Scaffolded a starter llms.txt at app/llms.txt/route.ts — ax filled in what it can derive…
[ax] ✓ wrote .ora/report.json (machine-readable build report)
[ax] Find your report at: .ora/report.json
[ax] Prompt for your coding agent (copy-paste):
[ax]   Read .ora/report.json and work through every check marked "actionable": create or improve
[ax]   those artifacts to make this site more agent-ready…
```

No network calls and no AI at build time — every byte is derived from your source tree. Three
runtime dependencies. Atomic writes, and the CLI exits non-zero rather than emit an invalid
catalog. 348 tests, including the spec's official conformance tool run over a corpus of real
fixture apps in CI.

> **Status:** pre-release, under active development. The detect-and-reference core, WebMCP
> detection, the agent-aware 404, the opt-in scaffolds, the Ora-mapped build report,
> review-before-publish, gated-surface detection (never advertise an auth-walled endpoint as
> open), and the `ax init` onboarding wizard are implemented and tested. Before the first public npm
> release: an end-to-end run against
> Ora's production crawler. Full phased roadmap and every design decision:
> [`docs-internal/PLAN.md`](./docs-internal/PLAN.md).

## `ax init` — one-command setup

Rather than hand-write `ax.config` and wire the build yourself, run the onboarding wizard:

```sh
npx ax init
```

It runs the same source-tree detection a build does (no `next build` needed), prints what it found,
then asks **only what the code can't answer** — your production `siteUrl`, which detected surfaces
agents can use without signing in (the rest are gated and never advertised as open), and one
pre-selected checklist of every opt-in scaffold, each line stating why agents need it — deselect
anything you don't want, then press Enter. It writes an `ax.config.ts` (or `.js`,
matching your project) with a one-line comment on every field, so the config it commits doubles as
its own documentation, and adds `"postbuild": "ax"` to `package.json` — but only when no `postbuild`
already exists; if one does, it prints the exact edit to make instead of chaining into a script it
doesn't own. It never overwrites an existing `ax.config.*`, and it generates no public artifact
itself — the first real build is still the moment the [review-before-publish](#the-catalog) gate
runs, now pre-answered by your choices.

It is a plain command, never a `postinstall` hook — installing the package stays inert. For CI or
scripting, run it unattended:

```sh
npx ax init --yes --site-url https://yourdomain.com
```

`--yes` accepts every default; `siteUrl` has no default (it's written verbatim into your public
catalog, so it must be given via `--site-url` or a `SITE_URL` / `NEXT_PUBLIC_SITE_URL` env var), and
the wizard exits non-zero with a clear message if it's missing or a localhost/preview URL.

> **Yes-when-asked, no-when-silent.** The scaffolds default to **off** in `ax.config` but the
> wizard's checklist lists every one of them **pre-selected**. That's one coherent policy, not a
> contradiction: a _silent_ write into your source tree on an unattended build is invasive, so
> config defaults are `false`; but in the wizard you're present and the list itself is the opt-in,
> so everything starts checked.

## Design posture

**Spec follower, never spec inventor.** The plugin translates code developers already wrote into
whatever shape the spec defines. **Precision over recall** — a wrong or dangerous catalog entry is
worse than a missing one, so route-level tool entries are explicit opt-in and zero-config publishes
only what is unambiguous.

## Supported matrix (v1)

This matrix is a public contract from day one. Anything outside it is out of scope for v1.

| Dimension       | Supported                                           | Out of scope for v1              |
| --------------- | --------------------------------------------------- | -------------------------------- |
| Next.js router  | **App Router and Pages Router** (and both at once)  | —                                |
| Next.js version | 14.x, 15.x (a CI canary job is planned)             | < 14                             |
| Language        | **JavaScript and TypeScript** apps                  | —                                |
| Config format   | `next.config.js` / `.mjs` / `.ts`                   | —                                |
| Node.js         | 18.18+, 20 LTS, 22 LTS                              | < 18.18                          |
| Bundler         | Webpack **and** Turbopack (CLI is bundler-agnostic) | —                                |
| Monorepo        | Turborepo: **detect-and-warn** planned for v1       | Full nested-workspace resolution |

> The monorepo support level is still an open decision — see the open-questions table in
> `docs-internal/PLAN.md`.

## Repository layout

```
packages/ax            the plugin / CLI (`@ora-ai/ax`) — the npm package (3 runtime deps: ajv, ajv-formats, jiti)
spec/                  vendored AI Catalog spec + hand-written JSON Schema + validator oracle
fixtures/*             minimal-but-real Next.js apps — the test suite, docs examples, and eval corpus
```

## The catalog

The `postbuild` run writes `public/.well-known/ai-catalog.json` with:

- **Site-level metadata** — `displayName` / `description` from `package.json`.
- **Zero-config artifact detection** (Phase 2.2) — detects and references what's already there:
  - An **MCP server** mounted via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) (or
    its legacy alias `@vercel/mcp-adapter`) → `application/mcp-server-card+json`.
  - A static **`public/openapi.json`** → `application/vnd.oai.openapi+json`.
  - An **`llms.txt`** served either as `app/llms.txt/route.ts` or `public/llms.txt` →
    `text/markdown`.
- **Config-declared entries** — anything you list in `ax.config`'s `entries`, e.g. docs/skills
  pointers (`text/html` / `application/ai-skill+md`).

Every entry above is validated against the AI Catalog spec before writing; the CLI refuses to
write (and exits non-zero) if generation ever produces an invalid catalog. The plugin only ever
**detects and references** — it never invents a per-route entry or synthesizes a doc from route
handlers (see `docs-internal/PLAN.md`'s _Scope_ and _Core design decisions_).

**Absolute URLs need a known site origin.** The spec requires every entry's `url` to be an
absolute URI, so a detector skips emitting its entry (with a warning) unless it can resolve the
site's origin. This must be your **public production URL** (e.g. `https://yourdomain.com`) — it's
written verbatim into the catalog's entry URLs, so a `localhost` or preview URL would publish broken
links. It's resolved in this order, first match wins:

1. `ax.config`'s `siteUrl` — an explicit declaration, always wins.
2. `SITE_URL`, then `NEXT_PUBLIC_SITE_URL` — the two env-var names Next.js apps most commonly use
   for a stable production URL. Expected to be an absolute `https://…` origin.
3. Vercel's build-time `VERCEL_PROJECT_PRODUCTION_URL` — injected automatically **on Vercel only**.

**Iterating locally.** `VERCEL_PROJECT_PRODUCTION_URL` exists only during a build _on Vercel_, so a
plain local `next build` can't resolve an origin from it — the catalog would come out without its
URL-bearing entries (MCP, OpenAPI, llms.txt) and you couldn't check your work before deploying.
Your production URL is the same string locally and in prod, so declare that (still the public
domain, **not** `localhost`): set `siteUrl` in `ax.config`, or run the build with
`SITE_URL=https://yourdomain.com next build` (or export `NEXT_PUBLIC_SITE_URL`). Any of these lets
you generate and preview the real catalog locally before deploying.

`ax.config.*` is evaluated as real code at build time (via [`jiti`](https://github.com/unjs/jiti)),
not parsed as static JSON — so if your host/CI uses a different variable name, `siteUrl:
process.env.DEPLOY_URL` (or whatever it is) works with no special support needed.

### Config (`ax.config.{ts,js,mjs,cjs}`)

Optional. Loaded from your project root; `.ts`/`.mjs`/`.cjs`/`.js` all work — named after the `ax`
tool that reads it, so the file you commit says plainly which tool it configures.

> If you still have an `ard.config.*` from before the 2026-07-27 rename, it's no longer read at
> all — rename it to `ax.config.*`. A build with only an `ard.config.*` fails loudly with that
> instruction rather than silently building with defaults, so this is safe to miss and easy to fix.

```ts
import { defaultIsGated, type AxConfig } from '@ora-ai/ax';

const config: AxConfig = {
  // Your production origin — every detected entry's URL is resolved against this. Optional: falls
  // back to a SITE_URL / NEXT_PUBLIC_SITE_URL env var, then (on Vercel) to
  // VERCEL_PROJECT_PRODUCTION_URL. Set it here to iterate locally, or to pin the URL on any host.
  // This file is real code, so reading it from a different env var works too:
  //   siteUrl: process.env.DEPLOY_URL,
  siteUrl: 'https://example.com',
  // Where to write the catalog. 'static' (default) writes public/.well-known/ai-catalog.json;
  // 'route' writes an App Router handler at app/.well-known/ai-catalog.json/route.ts instead
  // (for proxy setups and future dynamic catalogs). See the basePath note below.
  emit: 'static',
  // Scaffold a starter app/llms.txt/route.ts when neither it nor public/llms.txt exists, filled in
  // with your real routes and artifacts. Opt-in (defaults to false) — it writes into your source
  // tree, not just the catalog file.
  scaffoldLlmsTxt: true,
  // Scaffold an agent-aware app/not-found.tsx (written once, yours to edit) plus a route-manifest
  // data module regenerated on every build. Opt-in (defaults to false) — see "Agent-aware 404".
  scaffoldAgent404: true,
  // Append the Sitemap:/Agentmap: discovery pointers to your public/robots.txt, or write one when
  // you have no robots source at all. Opt-in (defaults to false) — see "Generated artifacts".
  scaffoldRobots: true,
  // Scaffold an app/organization-json-ld.tsx server component when no JSON-LD is rendered
  // anywhere. Opt-in (defaults to false); ax never edits your layout to wire it up.
  scaffoldJsonLd: true,
  // Generate markdown twins of your pages (route /docs → public/docs.md) plus /auth.md when
  // surfaces are gated. Default ON — twins are regenerated build artifacts, not scaffolds, and
  // their first write is confirmed at the review gate. See "Markdown twins".
  markdownTwins: true,
  // Write .ora/report.json, the machine-readable twin of the CLI output (true, or a custom path).
  // Opt-in (defaults to false); the CLI flag --report[=path] does the same per run.
  report: true,
  // Mark an artifact (MCP server, OpenAPI/REST surface, or a declared entry) as gated behind auth,
  // so it is never advertised as an open surface. Replaces the old denylist/allowlist pair — a
  // single matcher subsumes both: return `false` to re-include a path the floor would gate. A
  // gated artifact ax can describe (a detected withMcpAuth / OpenAPI securitySchemes) is emitted
  // with a secret-free `auth` descriptor; one it can't describe is dropped, not published — except
  // an MCP server, whose gated status *is* its description: it is always published with the auth
  // marker, never dropped. Usually you don't need this field for MCP at all: the gating answer
  // from `ax init` (or a build's review gate) is recorded in the committed server card, and only a
  // server with no recorded decision is asked about. With no isGated, a built-in floor gates
  // `/api/auth/**` and `/api/webhooks/**`; supplying isGated replaces that floor wholesale, so
  // compose `defaultIsGated` to keep it:
  isGated: (target) => defaultIsGated(target) && target.path !== '/api/auth/status',
  // Hand-declared entries — e.g. docs/skills pointers zero-config detection can't guess at. An
  // `identifier` matching a detected entry overrides/extends it field-by-field (never replaces it
  // outright); anything else is appended as a new entry.
  entries: [
    { identifier: 'urn:example:docs', type: 'text/html', url: 'https://example.com/docs' },
    // An entry's `auth` declares how agents authenticate when ax can't derive it — the endpoints
    // detection can never see (a withMcpAuth-wrapped MCP mount is only ever detectable as
    // "requires auth, scheme unknown"). Exactly the secret-free EntryAuth shape registries read:
    // status, OAuth endpoint URLs, scope keys, and a human docs URL — never credentials. Declared
    // once, it flows to the catalog entry, the MCP server card, and the generated /auth.md, and —
    // like a detected scheme — marks the surface gated. URL fields must be absolute http(s); the
    // config gate rejects anything else loudly, and a declared status that contradicts a detected
    // one wins with a warning.
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

An invalid config (unknown top-level key, wrong field type, ...) fails the build loudly with a
specific, actionable message — it is never silently ignored or partially applied.

### `next.config` reading

The CLI reads your `next.config.{ts,js,mjs,cjs}` (object or function form) to extract `basePath`,
`distDir`, and `output`, so you never repeat them in `ax.config`. Unlike the plugin's own
config above, a `next.config` that fails to load only warns and falls back to defaults — it's not
this plugin's place to fail your build over your Next.js config.

**`basePath` and where the catalog is served.** If your app sets `basePath`, the catalog is served
under that prefix (e.g. `/app/.well-known/ai-catalog.json`), not at the domain root crawlers probe.
Switching `emit` to `'route'` does **not** change this — an App Router route handler is subject to
`basePath` too. The in-spec fix (ARD §6.1) is to point crawlers at wherever the catalog actually
lives: on a `basePath` build the CLI prints a recommendation to add an HTML
`<link rel="ai-catalog" href="...">` tag to your root layout and an `Agentmap:` line to your
`robots.txt`.

## WebMCP detection (Phase 4)

The CLI detects **in-page WebMCP tools** (the W3C Web Machine Learning CG draft that lets a page
register tools a browser-resident agent can call) in both styles:

- **Declarative** — `<form toolname="..." tooldescription="...">`. Markup survives into
  server-rendered HTML, so these are also visible to HTML-reading scanners. Tools on
  statically-addressable App Router pages become `text/html` catalog entries whose `capabilities`
  carry the tool names.
- **Imperative** — `document.modelContext.registerTool()` / `provideContext()` in `'use client'`
  components, and the `useWebMCP()` hook (`@mcp-b/react-webmcp` / `usewebmcp`). These are
  runtime-only with no spec-defined manifest, so they are surfaced in the build summary and
  recommendations — never invented as catalog entries.

The detector also warns on the two mistakes that silently produce zero working tools: registration
via the **deprecated `navigator.modelContext`** alias (the entry point moved to
`document.modelContext` in the May 2026 draft; Chrome 150+ deprecates the alias), and registration
in a **server component** (no `'use client'`), where the API doesn't exist at render time. A
user-defined function that merely happens to be called `registerTool` is not detected. When an app
has `<form>` elements but no WebMCP at all, the CLI points out that every form is a latent agent
tool that two attributes make callable.

## Agent-aware 404 (`scaffoldAgent404`)

An agent that fetches a URL that doesn't exist gets a dead-end 404 and either gives up or
guesses. Setting `scaffoldAgent404: true` in `ax.config` scaffolds an **agent-aware
`app/not-found.tsx`** — written once, yours to edit, never overwritten — that tells agents why the
404 happened (the URL doesn't exist; don't retry) and how to continue: links to the site's
discovery artifacts (`ai-catalog.json`, `llms.txt`, sitemap — only the ones that actually exist)
and a list of the app's real routes, as visible HTML plus a schema.org `ItemList` in JSON-LD.

The route list lives in a companion data module (`app/not-found-agent-data.ts`) that **is
regenerated on every build** from the App Router source tree — the piece only a build-time tool
can supply, since nothing at runtime knows the route table. Dynamic (`[slug]`) routes are never
guessed. Without the opt-in, the CLI detects your existing `not-found.*` and recommends adding
agent signposts if it has none.

## Generated artifacts (opt-in scaffolds)

Most of what makes a site agent-ready is judgment work — what your site is _for_, which crawlers you
want, who you are as an entity. But the skeleton around that judgment is mechanical, and a build
step is better placed to write it than a person is: it already knows your route table, your
package.json, and which artifacts this build produced. So where the plugin can derive real content
it generates instead of advising, and stops at exactly the line where a guess would start.

Every scaffold follows the same three rules: **opt-in** via a config flag (it writes into your
source tree, not just the one file the plugin exists to produce), **write-once** (the file is yours
the moment it exists — ax never overwrites it), and **honest** (nothing invented; anything ax can't
derive ships as a marked TODO rather than plausible-looking filler).

### `scaffoldLlmsTxt` — a starter `llms.txt` with your actual content

`app/llms.txt/route.ts` (or `.js`), written once, containing: your `package.json` name and
description, a **Key pages** section listing your app's real statically-addressable routes (dynamic
segments are never guessed), and a **Machine-readable resources** section linking the artifacts this
build actually produced or detected — the catalog, `openapi.json`, an MCP endpoint — as absolute
URLs when the site origin resolved and served paths otherwise.

The **When to use** section is deliberately a TODO, and the comment says why: agent-readiness checks
look for real guidance about which tasks belong on your site, and an unedited placeholder scores the
same as no section at all. That paragraph is the one part of an llms.txt no build tool can derive,
so it's the one part left for you (or your coding agent) to write.

### `scaffoldRobots` — discovery pointers in `robots.txt`

What ax knows that your `robots.txt` doesn't is where the catalog it just generated lives, and
whether you actually have a sitemap. So:

- **You have a `public/robots.txt`** → ax _appends_ a `Sitemap:` line (only when a sitemap really
  exists) and an `Agentmap:` line pointing at the generated catalog, in a block marked
  `# Added by @ora-ai/ax`, and only when they're missing. Existing lines are never modified or
  reordered, a directive you already wrote counts as written (in any casing), and running twice
  appends nothing the second time.
- **You have an `app/robots.ts` route** → ax doesn't touch it. That file is code, and it owns your
  policy. (Next's `MetadataRoute.Robots` has no field for `Agentmap:` at all, so ax says so and
  leaves the choice to move to you.)
- **You have neither** → ax writes `public/robots.txt` with `User-agent: *` / `Allow: /`, explicit
  `Allow` blocks for reputable AI agent crawlers — the retrieval and search families across OpenAI
  (GPTBot, OAI-SearchBot, ChatGPT-User), Anthropic (ClaudeBot, Claude-SearchBot, Claude-User),
  Google (Google-Extended), Perplexity, Meta, Amazon, and others, kept in one shared corpus so the
  list never drifts — and the pointer lines above.

The generated file also carries a **commented-out** example of restricting training-only crawlers
(CCBot, Bytespider). It stays commented out on purpose: whether to block a crawler is a decision
about your content and your business, and the plugin says as much in the file rather than making it
for you.

### `scaffoldJsonLd` — an `Organization` block you can fill in

When nothing in your app renders JSON-LD, ax writes `app/organization-json-ld.tsx` — a small server
component rendering one `<script type="application/ld+json">` with a schema.org `Organization`:
`name` and `description` from `package.json`, `url` from the resolved site origin. `sameAs` ships
empty with a TODO, because the external profiles that actually do the entity-disambiguating
(LinkedIn, GitHub, npm, socials) live outside your repo and nothing at build time can derive them.

ax does **not** add the component to your `layout.tsx`. Editing the file every page renders through,
to insert an element, is not a change a postbuild step should make behind your back — so the CLI
prints the exact import and element to add, phrased for a coding agent to apply mechanically, and
the build report carries the same two strings. Until something imports it, the component publishes
nothing, and the report keeps saying so.

## Markdown twins & generated markdown (`markdownTwins`, default on)

Agents read markdown better than HTML, and the `.md`-URL convention (`/docs` → `/docs.md`) is the
one retrieval mechanism that needs **zero runtime**: ax writes each twin as a static file in
`public/`, so Next serves it as-is before any middleware ships. Twins are **generated artifacts,
not scaffolds** — regenerated every build, marked `generated-by: "@ora-ai/ax"` in their
frontmatter, never yours to edit (edit a page's twin and your edits are one build from gone; if a
human should own the markdown, make it a real markdown source instead — see Tier 1).

Where twin content comes from is a ladder of decreasing certainty; every rung ax refuses is
recorded in the report **with its reason**, so the skip list doubles as the what-to-do-next list:

- **Tier 1 — markdown sources in the repo.** An `app/**/page.mdx` (when `pageExtensions` routes
  it) becomes its route's twin directly — the markdown _is_ the source. Guard: the file must be
  mostly markdown (imports/exports/JSX ≤ 25% of non-blank lines); past that, stripping components
  would silently omit what the page shows, so ax recommends instead. A hand-written
  `public/<route>.md` (no generated-by marker) or an `app/<route>.md/route.*` handler already _is_
  the twin: ax records it and never touches it.
- **Tier 2 — the build output.** Every statically prerendered route's final HTML exists after
  `next build`; ax extracts the content region (`<main>`, else `<article>` — never `<body>`, which
  would drag nav/footer chrome in), converts it to markdown (turndown + GFM tables), and refuses
  anything that smells like a lie: no content landmark, under 200 chars of text (a JS shell),
  over the 100K-char truncation ceiling, an unclosed code fence — and **never a route your
  `isGated` gates** (a gated page's prerender is a login shell).
- **Tier 2½ — the metadata rung, for client-rendered pages.** A page whose prerender has no real
  content (a JS shell) can still earn a _minimal_ twin from its resolved `<title>`/description —
  but only when the page **declares that metadata itself** (`export const metadata` /
  `generateMetadata` in `page.tsx`; the rendered head can't distinguish page-owned metadata from
  the layout's cascade, so ownership is read from the source and values from the render) and the
  head isn't shared with another route (shared heads are inherited in practice — N identical twins
  would each claim to describe a specific page). The twin is explicit about what it is: title,
  description, and a wayfinding note (the content loads in the browser; start machine-readable
  access from the catalog). Labeled `source: "metadata"`
  in the report. The recommended page shape — a server `page.tsx` exporting metadata and rendering
  your client component — needs no pre-hydration placeholder DOM (which would paint and flicker).
- **Tier 3 — dynamic/SSR routes: refused.** No build-time HTML exists, so no twin and no guessed
  URLs; the CLI counts them and recommends adding a markdown source or prerendering.

Every twin opens with YAML frontmatter (`title`, `description` when the page declares one,
`canonical_url` — the attribution link back to the HTML page — and `last_updated`, the build
time). Twins never become catalog entries; they surface via the scaffolded `llms.txt`, the
`<link rel="alternate" type="text/markdown">` recommendation, and the serving manifest. The first
run that would write twins extends the review-before-publish summary (count + sample paths) behind
the same confirm/`--yes` gate as the catalog.

### Generated `/auth.md` — the gated-surface guide

When gated surfaces exist (a gated MCP mount, an OpenAPI doc declaring `securitySchemes`, a
declared entry with an `auth` descriptor), ax generates one `public/auth.md` aggregating what an
agent actually needs: which surfaces are gated, the scheme per surface (from the same secret-free
descriptors the catalog publishes, incl. OAuth endpoints and the RFC 9728 metadata link when
declared), and where a human obtains credentials (`auth.docsUrl` when declared; an explicit
"not documented yet" pointer otherwise). Your gated routes should keep their honest 401/403 and
point at it — the CLI prints that recommendation (`WWW-Authenticate` + a `Link` to `/auth.md`);
ax never rewrites your handlers.

When detection can only say "requires auth, scheme unknown" (a `withMcpAuth`-wrapped MCP mount),
declare the real endpoints on that entry in `ax.config` `entries` (see the `auth` example above) —
auth.md, the server card, and the catalog entry all pick the declaration up from that one place.

### The serving manifest — `ax manifest` and the `prebuild` slot

`ax manifest` regenerates a data module (`ax-manifest.ts`/`.js`, beside where `middleware.ts`
lives) recording the route table, which routes have markdown twins, which paths are gated, and
where the discovery artifacts live — all basePath-aware. It exists so a middleware **never
rewrites blind**: a middleware alone cannot check a rewrite target exists, but the build-time
source tree can. Ordering matters: `middleware.ts` is compiled _during_ `next build` while ax runs
postbuild, so the manifest is regenerated by a fast, source-tree-only `prebuild` step — `ax init`
wires `"prebuild": "ax manifest"` (never touching an existing prebuild). A full `ax` run also
refreshes an existing manifest module, but never creates one you didn't opt into.

### The runtime middleware — `@ora-ai/ax/middleware`

The negotiation half of the markdown story: detected AI agents — and any client sending
`Accept: text/markdown` — receive the markdown ax generated, without you writing serving logic.
The entry is **zero-dependency and Web-API-only** (Edge-safe): none of the CLI's dependencies
reach it, and `next` is only a type-level optional peer. Wire it by wrapping (never replacing)
your middleware:

```ts
// middleware.ts — the exact wiring the CLI prints; run `npx ax manifest` first
import { withAx } from '@ora-ai/ax/middleware';
import { axManifest } from './ax-manifest';

export default withAx({ manifest: axManifest }); // or withAx({ manifest: axManifest }, existingMiddleware)

export const config = {
  // Pasted as a literal — Next.js only accepts a statically analyzable matcher.
  matcher: ['/((?!_next|api|.*\\..*|favicon|robots|health|status).*)'],
};
```

Per request: a path whose **manifest-listed twin** exists is rewritten to it with `Vary: Accept`
plus a canonical `Link` back to the HTML URL (CDNs cache both variants correctly; crawlers
attribute to the right page); a **gated** path falls through untouched (your 401/403 stays the
honest answer); a real route without a twin falls through (its HTML is the only truthful
representation); a URL matching **no route** answers a detected agent with a `200 text/markdown`
wayfinding body rendered from the manifest — agents discard 404 bodies, so a dead end gets
directions while plain clients keep the honest 404. Under a **dynamic route's** prefix
(`/blog/[slug]`) nothing is ever claimed missing — only the app can know.

Detection is a three-layer cascade over one reviewed corpus (agent UA substrings,
`Signature-Agent`, a no-`sec-fetch-mode` heuristic) with two non-negotiable guards: traditional
search/preview/uptime bots are **never** rerouted (cloaking firewall), and a real browser document
navigation never matches on UA substrings — agent-embedded browsers (Cursor's says "Cursor") still
get HTML. The posture is recall-over-precision on purpose: mis-serving markdown to a misidentified
client is low-harm and reversible, unlike a wrong published claim — which is why emission keeps
the opposite posture. `onDetection` telemetry is armored (sync throws swallowed, promises to
`event.waitUntil()`), and canonical URLs derived behind a proxy are round-tripped through the URL
parser — an unparseable `Host` omits the header rather than reflecting raw input.

## Machine-readable build report (`--report` / `report`)

`ax --report` (or `report: true` in `ax.config`; a string value customizes the path)
writes **`.ora/report.json`** — the machine-readable twin of the CLI output: catalog entries and
where they were written, detected MCP mounts and the server card path, WebMCP tool sites, presence
of every detect-and-recommend artifact (robots.txt / sitemap / agents.md / JSON-LD / llms.txt /
openapi.json), agent-404 status, what each opt-in scaffold wrote or skipped and why, the byte and
estimated-token size of every generated artifact, and every warning and recommendation verbatim. A
coding agent (or CI step) reads one JSON file instead of parsing log lines — point your agent at it
after a build and let it work through the recommendations.

### The `ora` section — recommendations in Ora's check language

A list of recommendations tells an agent what to do but not whether it worked.
[Ora](https://ora.ai) scores agent-readiness against a registry of named checks, so the report's
`ora` section translates this build's findings into those check IDs and hands over everything needed
to close the loop:

```jsonc
{
  // Byte + estimated-token size of each generated artifact (chars ÷ 4), with an entry flagged when
  // it exceeds the 100K-char limit an agent would truncate.
  "sizes": [
    {
      "artifact": "ai-catalog.json",
      "path": "public/.well-known/ai-catalog.json",
      "bytes": 512,
      "chars": 512,
      "tokens": 128,
    },
  ],
  "ora": {
    // MCP server for Ora's agent-ready-website skill (tools: list_skills, get_skill)
    "skillMcp": "https://ora.ai/skill/mcp",
    "skillUrl": "https://ora.ai/.well-known/agent-skills/agent-ready-website/SKILL.md",
    "scanApi": {
      "scan": "POST https://ora.ai/api/scan",
      "score": "GET https://ora.ai/api/score/{domain}",
    },
    "checks": [
      { "id": "ard-catalog", "artifact": "ai-catalog.json", "status": "addressed" },
      { "id": "llms-txt-exists", "artifact": "llms.txt", "status": "actionable" },
      {
        "id": "json-ld",
        "artifact": "json-ld",
        "status": "actionable",
        // A scaffold that's started but unfinished is still actionable — with the specific next
        // step, not just "it's missing".
        "note": "An Organization JSON-LD component was scaffolded at … but nothing renders it yet…",
      },
    ],
  },
}
```

`status` is two-valued on purpose (`addressed` / `actionable`): the report is read by an agent
deciding what to work on, and every richer vocabulary collapses to that question anyway. The mapping
lives in [`src/ora-checks.ts`](./packages/ax/src/ora-checks.ts) and is intentionally conservative —
an artifact is listed against a check only when its _presence_ is what the check looks for, and a
check ax has no build-time signal for is absent rather than guessed at. A check missing from the
section is not a claim that your site fails it; it means this build can't speak to it.

When anything is still actionable, the CLI closes with a short handoff footer pointing at the
report, Ora's skill server, and the scan that verifies the result against your deployed site:

```
[ax] Agent handoff: .ora/report.json maps every recommendation to Ora's agent-readiness checks.
[ax]   Point your coding agent at it and connect Ora's skill server (MCP): https://ora.ai/skill/mcp
[ax]   Then scan your deployed site: POST https://ora.ai/api/scan {"url": "https://yourdomain.com"}
```

A build with nothing left to do prints no footer.

## Discovery recommendations

Beyond the catalog, the CLI detects the discovery/access artifacts agent registries score and prints
advisory recommendations (never catalog entries, never a build failure): whether you have a
`robots.txt` with agent-scoped `Allow` rules, a `sitemap` (it points at the built-in
`app/sitemap.ts` — it never generates one itself), an `agents.md`, JSON-LD structured data, and an
`llms.txt`. Where signals reinforce each other — e.g. `llms.txt` (what your site is for) and JSON-LD
(what entity it is) — the recommendation says so, so you add the pair rather than one in isolation.
The recommendations name Next.js conventions and file paths, not third-party packages. These are
recommendations only; you decide what to act on — though for `robots.txt`, `llms.txt` and JSON-LD you
can opt into having the derivable part written for you instead (see
[Generated artifacts](#generated-artifacts-opt-in-scaffolds)).

## Development

Requires Node 18.18+ and pnpm.

```sh
pnpm install
pnpm typecheck   # tsc across the workspace
pnpm test        # package unit tests (incl. the spec validator)
pnpm lint        # prettier --check
pnpm fixtures:build   # build every fixture app
```
