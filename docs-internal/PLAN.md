# Ora Next.js Plugin — Development Plan

Generates a spec-valid `ai-catalog.json` (Agentic Resource Discovery / AI Catalog spec) from a
Next.js app at build time, so agents and registries (Ora) can discover the site's capabilities.

Developers use Next.js to build and deploy full-stack apps with an easy way to configure APIs and MCP
servers. **The plugin's job is to make those apps discoverable to agents** — by generating an
ai-catalog from what the app already has: MCP servers configured the Next.js way, a
`public/openapi.json`, and developer-declared docs/skills. It **detects and references**; it never
invents per-route "tool" entries. See *Scope* and *Ground truth from Ora's index* below.

**Posture:** spec follower, never spec inventor. The plugin translates code developers already
wrote into whatever shape the spec defines. No speculative support for unresolved spec points
(e.g. WebMCP "skills").

**v1 success criterion:** Ora's own site plus 1–2 partner sites publish valid catalogs generated
by this plugin, and Ora's registry successfully crawls and indexes them.

**Core design decisions (already made):**

- **Precision over recall.** A wrong or dangerous catalog entry is worse than a missing one. The
  plugin only **detects and references** what is unambiguous — an MCP server, a `public/openapi.json`,
  or developer-declared docs/skills. It never invents a convention or synthesizes an entry from code
  the developer didn't intend to publish.
- **Align with what Ora ingests and rewards.** Confirmed with Ora (2026-07-16): the crawler ingests
  the first-party `/.well-known/ai-catalog.json`, `openapi.json`, `/graphql`, and `llms.txt`. Real
  top-ranked catalogs (Telnyx 98/A+, Vercel 78/B, GitHub 70/B) are built from OpenAPI docs, MCP
  servers, GraphQL, `llms.txt`, docs pointers, and agent skills — never per-route tool entries. The
  plugin emits the **Next-idiomatic subset** of that taxonomy (see *Scope* and *Ground truth from
  Ora's index*).
- **Detect existing artifacts; don't extract from user code.** For OpenAPI the plugin references the
  doc the app already produces (a committed `public/openapi.json`) — it does not parse route handlers
  or convert the developer's Zod schemas. (Any AST work is confined to WebMCP detection in Phase 4,
  and even there for *location*, not semantics.)
- **Fixtures are the backbone.** The fixture corpus is simultaneously the test suite, the docs
  examples, and the eval corpus.
- **Near-zero runtime dependencies.** This is library code installed into many builds.
- **Postbuild CLI, not a `withPlugin()` next.config wrapper.** Wrappers work via webpack hooks,
  which Turbopack doesn't run — that pattern is disappearing. A standalone CLI is
  bundler-agnostic, keeps heavy work (subprocess evaluation, AST scans) out of the dev server,
  and gives CI/dry-run/review flows a natural entry point. The CLI reads the user's
  `next.config.*` itself for the values it needs (`basePath`, `distDir`, `output`), so nothing is
  duplicated in `ard.config.ts` (the `next-sitemap` model).

---

## Scope

The plugin helps Next.js full-stack apps — which already configure APIs and MCP servers the Next.js
way — become discoverable to agents, generating an ai-catalog from what the app already has.

**In scope (v1):**

- MCP servers configured the Next.js way (`mcp-handler`) → `application/mcp-server-card+json`.
- A static `public/openapi.json` → `application/vnd.oai.openapi+json`.
- A configurable way for the developer to declare where their **docs** and **skills** live (URLs in
  `ard.config`) → `text/html` / `application/ai-skill+md` entries.
- **`llms.txt`** served the Next.js way — reference an existing one (a route handler at
  `app/llms.txt/route.ts`, or a static `public/llms.txt`), and scaffold a starter route handler when
  absent → `text/markdown`. (Idiomatic Next.js pattern; cheap.)
- **Discovery/access artifacts Ora scores (detect-and-recommend, never reimplement):** `robots.txt`
  (agent-crawler allow rules + catalog pointer), `sitemap.xml` (delegate generation to
  `next-sitemap`; detect + warn-if-absent only), and `agents.md` (agent-guidance file; content
  authored by the companion skill, not guessed). See the 2026-07-22 ground-truth update below.

**Near-future (post-v1):**

- WebMCP discoverability — in-page `navigator.modelContext` tools and declarative `<form toolname>`.

**Out of scope:**

- **GraphQL.** Not idiomatic to Next.js, so the plugin does not emit `application/graphql` even though
  Ora's crawler ingests it for other stacks.
- Synthesizing an OpenAPI doc from bare route handlers, or any invented marker convention.
- **Sitemap generation.** `sitemap.xml` is scored by Ora, but generating it is a solved, idiomatic
  Next.js concern (`app/sitemap.ts` / `next-sitemap`) — the plugin detects and recommends, never
  reimplements.
- **Ora's Payments layer (10 pts)** — agentic payment rails; nothing a catalog generator emits.
- **Runtime API-behavior checks** — `rate-limit-headers`, `idempotency-key-support`, JSON error
  model, catch-all JSON 404, JSON index at `/api` roots. These are route-handler *behavior*, not
  build-time output; companion-skill/docs territory or out of scope (see 2026-07-22 update).

---

## Ground truth from Ora's index (added 2026-07-16 — reshaped this plan)

We reviewed real Ora catalogs for the top-ranked sites (Telnyx 98/A+, Vercel 78/B, GitHub 70/B) and
confirmed key facts with Ora. This is the single best signal for what the plugin should emit, and it
**replaced the earlier "per-route tool entry" model.**

**These are Ora's _crawler outputs_, not first-party files.** `host.identifier` is `did:web:ora.ai`
and entries carry `provenance: { basis: "detected" | "discovered" }`. So they show what Ora *looks
for and rewards* — which is exactly what the plugin should help a site expose.

**Confirmed with Ora — the crawler ingests these first-party artifacts directly:**
`/.well-known/ai-catalog.json`, `openapi.json`, `/graphql`, and `llms.txt`. So the plugin's job is
twofold: (a) publish a catalog that references a site's artifacts, and (b) make sure those artifacts
exist at conventional, discoverable locations.

**Observed entry taxonomy** (every `type` is an open media-type string — validates the deliberately
permissive schema):

| `type` | What it is | Next.js source |
|--------|-----------|----------------|
| `application/vnd.oai.openapi+json;version=3.1` | **One** OpenAPI doc for the whole REST API | served `openapi.json` (detected), or generated from opted-in typed routes |
| `application/graphql` | GraphQL endpoint | — out of scope (not idiomatic Next.js) |
| `application/mcp-server-card+json` | MCP server(s) | `mcp-handler` mount |
| `application/ai-skill+md` | Agent skills, often many, from a GitHub repo | a skills repo the org publishes |
| `text/markdown` | `llms.txt` | served `llms.txt` |
| `text/html` | docs pointers: developer portal, API docs, pricing, rate limits, auth docs | ordinary pages/files |

**Correction (2026-07-19, from the ARD spec §4.2):** most of what this section originally called
"Ora extension fields" are **first-class ARD entry fields**: `capabilities`,
`representativeQueries`, and `trustManifest` are standard optional fields, not extensions.
`representativeQueries` in particular is *the* semantic-search signal — registries build vector
embeddings from it, and the schema enforces 2–5 items — so letting developers declare it per entry
(supported via `ard.config` `entries`) directly improves discoverability, not just Ora's score.
Only `auth` and entry-level `provenance` are genuine extensions (legal: entries allow unknown
keys; the manifest root and `host` do **not** — the ARD schema closes them). The plugin populates
the self-declarable ones (`capabilities` for MCP zero-config; `representativeQueries`/`auth` via
config) where cheap.

**Scoring tell:** the A+-vs-B differentiator is *breadth of machine-readable artifacts*, not depth.
Telnyx (A+) is the only one exposing a full OpenAPI doc **plus** `pricing.md`, `rate-limits.json`,
and auth metadata. So the plugin maximizes value by helping emit as many applicable artifact types as
possible.

**The route-handler reframe (important):** individual route handlers are **not** emitted as per-route
catalog entries — nobody publishes those. They are the *source* for a single generated OpenAPI
document (one `application/vnd.oai.openapi+json` entry, the Telnyx shape). If an app already serves an
OpenAPI doc, the plugin **detects and references** it rather than regenerating. (GraphQL is out of
scope — see *Scope*.)

---

## Ground truth from Ora's published skill (added 2026-07-22 — corrected the artifact scope)

Ora publishes a live skill for coding agents over MCP (`ora.ai/skill/mcp` → `agent-ready-website`),
served dynamically and updated as standards evolve. Fetching it directly (2026-07-22) is the
strongest ground truth yet — it lists the exact checks behind the **Ora score** (0–100, A+–F) and
**corrected three assumptions in this plan.**

**Ora's score = 4 weighted layers** (capability categories, not files):
**Usability 40** (operate APIs/UI) · **Accessibility 30** (reach + parse content) ·
**Discovery 20** (off-site findability) · **Payments 10** (agentic payment rails).

**Corrections (each is a live scored check):**

- **robots.txt is scored** — `robots-ai-policy-quality`, `bot-detection`, `agent-crawler-reachability`.
  Explicitly allow reputable AI crawlers (or state a documented policy). Earlier assumption
  ("gate only, not ingested") was wrong.
- **sitemap.xml is scored** — `sitemap` ("all public routes; reference it from robots.txt"). Earlier
  assumption ("not ingested") was wrong. Still **delegate generation** to `next-sitemap`; the plugin
  detects + warns-if-absent only.
- **agents.md is scored** — an agent-guidance file with explicit *when-to-use / when-NOT-to-use*
  sections. Earlier dismissal ("speculative, don't build") was wrong. In scope as a
  detect-and-recommend / skill-authored target.

**`ai-catalog.json` stays the core.** The skill currently references RFC 9727 `/.well-known/api-catalog`
(`application/linkset+json`) rather than ARD `/.well-known/ai-catalog.json` — **confirmed with Ora
(2026-07-22) to be a known bug in the skill; a fix to reference `ai-catalog.json` is expected.** So
the plugin's headline output is unchanged (open question #16 tracks the confirmation).

**Two acknowledged gaps — neither reopens the plugin's core:**

- **Payments layer (10 pts)** — agentic payment rails. Out of plugin scope; documented gap.
- **Runtime API-behavior checks** — `api-error-model`, `rate-limit-headers`, `idempotency-key-support`,
  JSON error responses, catch-all JSON 404, JSON index at `/api` roots. These are route-handler
  *behavior* a build-time catalog generator cannot emit — companion-skill/docs territory or out of
  scope, not plugin work.

**Plugin-vs-skill division (validated):** Ora already ships `agent-ready-website` as a scan→fix→rescan
skill. Our companion skill **composes with it** rather than duplicating the loop — the plugin owns the
deterministic detect/emit/validate half; the skill owns the judgment/authoring half. See Phase 6.

---

## Phase 0 — Alignment & groundwork

Goal: requirements ratified by Ora, spec pinned, project scaffolded. No plugin logic yet.

### 0.1 Alignment with Ora (first meeting)

- [ ] Present this plan; get sign-off on the overall shape.
- [ ] Ratify the **open product questions** (see bottom of this doc) — record decisions inline there.
- [ ] Confirm the v1 success criterion and rough timeline expectations.
- [ ] Get access to: Ora's registry/crawler (or a staging instance), AgentJourney
      (journey.ora.ai) API access if it exists, their own site's repo if it's the first
      integration target, and whoever owns the spec relationship.

### 0.2 Pin the spec surface

**Superseding finding (2026-07-19): the ARD spec DOES publish formal schemas + an official
conformance tool.** The earlier finding ("no formal schema", verified 2026-07-16) was true only of
the base [Agent-Card/ai-catalog](https://github.com/Agent-Card/ai-catalog) repo. The ARD layer —
[ards-project/ard-spec](https://github.com/ards-project/ard-spec), rendered at
agenticresourcediscovery.org/spec — ships an authoritative CDDL, a JSON Schema
(`spec/schemas/ai-catalog.schema.json`, Draft 2020-12), a registry OpenAPI 3.1 spec, and a
zero-dependency Python conformance CLI (`conformance/bin/conformance-test`). These are vendored in
`spec/ard/` (pinned commit in `spec/ard/README.md`) and answer open question #12: the official
tool is the oracle. Also note ADR-0011: upstream dropped the `.well-known` *requirement*; the
`.well-known/ai-catalog.json` location is an ARD-layer convention (`specVersion: "1.0"`).

**Two oracles, two roles** (the ARD schema is strictly stronger than the base prose — required
entry `displayName`, `urn:air:` identifier pattern, closed root/host objects — and the upstream
Agent-Card example does *not* pass it, so both layers stay pinned):

- [x] Hand-written permissive JSON Schema in `spec/` derived from the base prose spec — the
      *acceptance* check (`validateCatalog`): reject only what the spec explicitly forbids.
      Upstream example vendored as a must-validate test case.
- [x] **Official ARD schema vendored verbatim** (`spec/ard/`) — the *emission* gate
      (`validateCatalogArd`, enforced by `writeCatalog`): everything the plugin writes must pass
      the official conformance tool, which runs this exact schema plus semantic checks (URN
      format, value-or-reference, `representativeQueries` sizing 2–5).
- [x] Official conformance CLI vendored and wired into CI (`pnpm conformance` runs it over every
      generated fixture catalog).
- [x] Record the upstream commits both schemas derive from; upgrade policy: spec bumps are
      explicit PRs with a changelog entry, never silent updates. (`spec/README.md`,
      `spec/ard/README.md`.)
- [x] Entry **identifiers follow the ARD URN format** `urn:air:<publisher>:<name>` (§4.2.1), where
      `<publisher>` is the site's domain (from `siteUrl`) — the verifiable trust anchor registries
      extract as the filterable `publisher` field. Detector segments are sanitized to the schema's
      `[a-zA-Z0-9._-]` alphabet (an MCP mount at `/api/tools` → `urn:air:<domain>:mcp-server:api-tools`).
- [x] Treat catalog `type` fields as open string lists, not enums (IANA registrations not final —
      ARD §3.3 explicitly tells intermediaries to skip strict type verification; the conformance
      tool warns-not-fails on unknown types).
- [x] No `host.description`: the ARD schema closes the host object (`additionalProperties: false`),
      so the package.json description is no longer emitted there. Worth filing upstream — a host
      description field seems like an obvious gap.
- [ ] Trust Manifest / attestations: **out of scope for v1 emission** beyond not emitting anything
      that conflicts with it — confirm with Ora whether their score checks trust fields (relates
      to open question #10's "whole score" framing). Note if ever emitted: the ARD schema requires
      `mediaType` on attestations (the prose tables omit it) and closes `identityType` /
      `provenance.relation` to enums.

### 0.3 Decide the supported matrix

- [ ] Next.js: App Router only for v1 (Pages Router explicitly out of scope — confirm with Ora).
- [ ] Pin supported Next.js minors (e.g. 14.x, 15.x, canary-as-canary) and Node LTS versions.
- [ ] Decide monorepo (Turborepo) support level for v1: detect-and-warn vs full support.
- [ ] Write the matrix into README so it's a public contract from day one.

### 0.4 Scaffold the repo

- [ ] pnpm workspace: `packages/ax` (the plugin/CLI), `fixtures/*`, `spec/`.
- [ ] TypeScript strict, tsup (or similar) build, vitest, changesets, CI skeleton (lint + typecheck
      + test on PR).
- [ ] npm publish config with provenance enabled; `files` allowlist so nothing extra ships.

### 0.5 Build the initial fixture corpus

Each fixture is a minimal but real Next.js app. `[x]` = built and green (Next 15.5.20). The corpus
spans **both JS and TS** and all three config formats — `bare` (TS, `.mjs` config), `bare-js` (JS,
CommonJS `.js` config), `deploy-variants` (`.ts` config) — so the CLI's config loader and (later)
`.js`/`.jsx` vs `.ts`/`.tsx` scanning are both exercised.

- [x] `bare` — fresh create-next-app (TypeScript), no config, no tools.
- [x] `bare-js` — the JavaScript baseline: `.jsx` components, CommonJS `next.config.js`,
      `jsconfig.json`.
- [x] `mcp-adapter` — app with an existing MCP server via `mcp-handler` (renamed from
      `@vercel/mcp-adapter`, now a stub).
- [x] `webmcp-imperative` — `navigator.modelContext.registerTool()` in client components.
- [x] `webmcp-declarative` — JSX `<form toolname=...>` usage.
- [x] `edge-cases` — WebMCP-detection adversarial cases: conditional registration, `registerTool`
      wrongly in a server component, a user-defined function coincidentally named `registerTool`
      (must NOT detect).
- [x] `deploy-variants` — `basePath` set, `output: 'standalone'`, in a TypeScript `next.config.ts`.
- [x] `monorepo` — Turborepo with the app nested one level down.
- [x] `openapi` — app committing a static `public/openapi.json`; detect-and-reference for a
      `application/vnd.oai.openapi+json` entry (the Telnyx shape).
- [x] `llms-txt` — app serving `/llms.txt` via a route handler (`app/llms.txt/route.ts`,
      `force-static`); detect-and-reference for a `text/markdown` entry.
- [x] `config-overrides` — app with an `ard.config.ts` declaring entries plus denylist/allowlist
      (added Phase 2.1); exercises config loading, config-declared entries, and the
      denylist-with-allowlist-re-inclusion safety net end to end.

**Done when:** spec vendored + validator green on a hand-written sample catalog; fixtures build;
CI runs on PR; Ora has signed off on the open questions.

---

## Phase 1 — Walking skeleton (target: end of week 1)

Goal: the thinnest end-to-end slice — a real catalog, served from a real deployment, crawled by Ora.
This de-risks the one integration nobody has tested: does Ora's crawler actually pick it up?

- [x] CLI entry point: `npx ora-catalog` runnable as a postbuild step. (`packages/ax`:
      `src/bin.ts` is the published `bin`; `src/cli.ts` is the testable orchestration it wraps.)
- [x] Emit a minimal, mostly-static but **spec-valid** `ai-catalog.json` (site-level metadata only)
      into `public/.well-known/`. (`src/generate.ts` + `src/site-metadata.ts` — `host.displayName`
      / `description` from `package.json`, empty `entries`. Zero-config artifact detection is
      Phase 2.)
- [x] Run `validateCatalog` on the output before writing; hard-fail on invalid. (`src/write.ts` —
      never writes on a validation failure; atomic write via temp-file + rename otherwise.)
- [x] Wire it into the `bare` fixture's `postbuild` script. (Also wired into `deploy-variants` to
      exercise the limitation below.) Verified: `pnpm --filter @ora-catalog/fixture-* run build`
      runs `next build` then `ora-catalog` automatically via pnpm's lifecycle hooks, no extra
      config needed.
- [ ] **Deploy the fixture to Vercel; confirm the file is served at
      `https://<domain>/.well-known/ai-catalog.json` with correct content-type.** Requires a Vercel
      project/account — not something this environment can do. Next manual step.
- [ ] **Run the deployed domain through journey.ora.ai (AgentJourney) and confirm the ai-catalog
      is discovered and reflected in the agent-readiness rating.** This is the on-demand
      verification loop — no crawler wait. If the catalog isn't picked up, this is the week-1
      finding that reshapes the plan. Blocked on the Vercel deploy above + AgentJourney access.
- [ ] Confirm with Ora whether AgentJourney discovery also feeds the registry/index, or whether
      registry inclusion is a separate step (submission/crawl). Requires direct contact with Ora.
- [x] Verify (and document) behavior on the `deploy-variants` fixture: `basePath` breaks static
      `public/` serving — note the limitation now, route-handler emission comes in Phase 2.
      **Verified empirically** (`next dev` against the fixture): with `basePath: '/app'`, the
      catalog serves at `/app/.well-known/ai-catalog.json` (200) but 404s at the conventional
      `/.well-known/ai-catalog.json`. Also found and documented a related standalone-output gap —
      see `fixtures/deploy-variants/README.md`.

**Done when:** a Vercel-deployed fixture's catalog is live at the well-known URL and visible in
Ora's registry. **Code-side work is complete and green** (build/typecheck/test/lint/fixture builds
all pass — see PR); the deploy + AgentJourney + Ora-confirmation steps require external
accounts/access this environment doesn't have and are the immediate next actions for a human.

---

## Phase 2 — Catalog core: config, emission targets, drift

Goal: the `next-sitemap`-style production core. Stable regardless of spec churn.

### 2.1 Config

> **Renamed `ard.config` → `ax.config` (2026-07-27, per Ora's decision).** The bullets below keep
> their original wording; what shipped is `ax.config.{ts,mts,cts,mjs,js,cjs}`, typed with `AxConfig`
> and failing loudly via `AxConfigError`. This supersedes the vendor-neutrality rationale recorded
> below — the file is now named after the `ax` tool that reads it, so a file committed into a
> consumer's repo says which tool it configures. A legacy `ard.config.*` still loads, with a
> deprecation warning; when both exist the `ax.config.*` wins and the `ard.config.*` is ignored
> (also warned). `ArdConfig` / `ArdEntryOverride` / `ResolvedArdConfig` / `ArdConfigError` /
> `loadArdConfig` / `validateArdConfig` / `ardConfigSchema` remain exported as deprecated aliases,
> so existing imports keep resolving.

- [x] `ard.config.{ts,mts,cts,mjs,js,cjs}` — typed config, validated via JSON Schema through the
      existing Ajv instance (not Zod — see *decision* below), loaded via the CLI. Named `ard.config`
      (Agentic Resource Discovery), not after this package or Ora — it's a file committed into the
      consumer's repo, so it stays vendor-neutral (endgame: upstreaming into Next.js).
- [x] Load the user's `next.config.*` (js/mjs/ts) and extract `basePath`, `distDir`, and `output`
      so users never repeat Next settings in plugin config. Handle both object and function-form
      configs; on load failure, warn and fall back to defaults (never crash over their config).
      (`src/next-config.ts`, loaded via `jiti` — the one new runtime dependency this needs, since
      Node can't natively `import()` a `.ts` config file itself.)
- [x] Test next-config loading against the `deploy-variants` and `monorepo` fixtures.
      (`test/fixtures-integration.test.ts`.)
- [x] Build-time validation fails loudly with actionable messages on invalid config.
      (`ArdConfigError`, caught in `cli.ts` and reported without a stack trace.)
- [x] Config **overrides/extends** inferred entries; it never silently replaces them.
      (`src/entries.ts` `applyEntryOverrides` — merges by `identifier`, appends otherwise.)
- [x] Denylist support, with a default-on denylist (`/api/auth/**`, `/api/webhooks/**`); allowlist
      to re-include. (`src/denylist.ts`.)


### 2.2 Zero-config inference & artifact detection (aligned with Ora's index)

Detect-and-reference is the cheapest, highest-value work — it mirrors exactly what Ora's crawler
already rewards. Zero-config, in rough priority order:

- [x] Emit site-level metadata (name + domain from package.json / config). Domain can
      now also come from `ard.config`'s new **`siteUrl`** (see below), not just Vercel's env var.
      (**Changed 2026-07-19:** package.json's description is no longer emitted as
      `host.description` — the official ARD schema closes the host object, so that key fails
      conformance. See Phase 0.2.)
- [x] Detect an existing **MCP server** configured the Next.js way (`mcp-handler`, legacy alias
      `@vercel/mcp-adapter`) → `application/mcp-server-card+json`. Unambiguous intent to publish.
      Populate `capabilities` / `auth` where statically derivable. (`src/detect-mcp.ts` — textual
      detection, not AST, per the core design decisions; `capabilities` populated from `.tool(...)`
      call sites; `auth` deliberately **not** derived — no cheap, reliable static signal for it, so
      it's left as a documented gap rather than guessed.)
- [x] Detect a static **`public/openapi.json`** and reference its URL →
      `application/vnd.oai.openapi+json`. Details in Phase 3. (`src/detect-openapi.ts`.)
- [x] Emit **docs** and **skills** entries (`text/html` / `application/ai-skill+md`) from URLs the
      developer **declares in `ard.config`**. Config-driven, not guessed — the developer knows
      where their docs and skills live; the plugin doesn't spider for them. (Already covered by the
      generic `entries` override mechanism from 2.1 — see the `config-overrides` fixture, which
      already declares exactly this shape. No new config surface needed.)
- [x] Reference an existing **`llms.txt`** served the Next.js way — a route handler at
      `app/llms.txt/route.ts` (often `dynamic = 'force-static'`) or a static `public/llms.txt` →
      `text/markdown`. Scaffold a starter route handler when absent (v1; cheap, idiomatic).
      (`src/detect-llms-txt.ts`. **Deviation from the plan as written:** scaffolding is **opt-in**
      via `ard.config`'s `scaffoldLlmsTxt: true`, defaulting to `false` — writing a *second* file
      into a consumer's `app/` directory is a bigger, unsolicited source-tree mutation than the one
      catalog file this plugin exists to produce, and an opt-out default is too easy to miss for a
      build tool meant to run unattended across many sites. This was found empirically: with an
      opt-out default, this repo's own test suite silently scaffolded files into four unrelated
      fixtures the first time it ran.)
- [x] Do **not** synthesize an OpenAPI doc from bare route handlers; reference only a doc the app
      actually produces. Most route handlers are internal BFF endpoints and must not be exposed.
- [x] Do **not** emit GraphQL entries — out of scope (see *Scope*).

**New config surface added to support the above:** `ard.config`'s `siteUrl` — an explicit absolute
origin (e.g. `https://example.com`). The catalog schema's `url` fields require an absolute URI
(`format: uri`), so every detector above needs a known site origin to build one; without `siteUrl`
(and without Vercel's build-time `VERCEL_PROJECT_PRODUCTION_URL`), a detector still runs but skips
emitting its URL-bearing entry — with a warning — rather than emit a relative or guessed URL.
Precision over recall, applied to the plugin's own output, not just to what it detects.

### 2.3 Review-before-publish flow

- [ ] First run (no committed catalog present): print a full "about to expose" summary and write
      the catalog only after `--yes` / interactive confirm; CI mode requires the flag.
- [ ] Every run prints a build summary: `✓ N artifacts referenced (MCP/OpenAPI/docs/skills),
      K warnings`.

### 2.4 Emission targets

- [x] Static file into `public/.well-known/` (default). (`src/write.ts` — the Phase 1 target.)
- [x] Alternative: generate a route handler (`app/.well-known/ai-catalog.json/route.{ts,js}`) for
      `basePath`/proxy setups — also the future path to dynamic catalogs. Opt in via `ard.config`'s
      new **`emit: 'route'`** (default `'static'`); the validated catalog is embedded as a
      `force-static` response. (`src/write.ts` `writeRouteHandler`.) **Finding:** a route handler is
      *also* subject to `basePath`, so it is not itself the `basePath` fix — the §6.1 discovery
      pointer below is. `.ts`/`.js` mirrors the project; falls back to the static target (with a
      warning) when there's no App Router dir.
- [x] **Spec-blessed alternate discovery mechanisms (ARD §6.1)** — the in-spec fix for the Phase 1
      `basePath` finding (catalog serves under the prefix, 404s at the conventional well-known
      path): recommend an HTML `<link rel="ai-catalog" href="...">` tag (root layout) and a
      robots.txt `Agentmap:` directive pointing at wherever the catalog actually lives. Emitted only
      when a `basePath` is set (no prefix ⇒ already at the conventional path ⇒ no pointer needed).
      (`src/discovery.ts`, surfaced via the new recommendation channel.) DNS SRV-style records are
      also in §6.1 but are out of the plugin's reach — document only.
- [x] **robots.txt — detect-and-recommend (scored by Ora: `robots-ai-policy-quality`).** Detect an
      existing `public/robots.txt` or `app/robots.ts`; recommend Allow rules scoped to specific
      user-agents, **never `User-agent: *`**, plus the `Sitemap:` / `Agentmap:` pointers; when absent,
      recommend adding one. Never unblocks scrapers on the owner's behalf. (`src/detect-robots.ts`.)
      **Deviation:** recommend-only for now — no auto-write. The exact `Allow` token depends on Ora's
      crawler user-agent (open question #17, still pending), so writing a *guessed* policy would
      violate precision-over-recall; the opt-in auto-write is deferred until #17 resolves. Also noted:
      `MetadataRoute.Robots` (`app/robots.ts`) has no field for the `Agentmap:` pointer, so that line
      is recommended for a static `public/robots.txt`.
- [x] **sitemap.xml — detect + recommend (scored by Ora: `sitemap`).** Detect `app/sitemap.ts` /
      `public/sitemap.xml`; when absent, recommend `next-sitemap` (or `app/sitemap.ts`) and reference
      it from robots.txt. **Never reimplements** — a solved, idiomatic Next.js concern.
      (`src/detect-sitemap.ts`. The plan said "warn-if-absent"; implemented on the advisory
      recommendation channel alongside robots/agents.md, so all three read as one consistent block.)
- [x] **agents.md — detect-and-recommend (scored by Ora).** Detect an existing `public/agents.md` (or
      an App Router `agents.md/route.*`); when absent, recommend one. Content (the when-to-use /
      when-NOT-to-use guidance) is authored by the companion skill (Phase 6), never guessed.
      (`src/detect-agents-md.ts`.)
- [x] Fixture + test for each target. Unit tests per module (`detect-robots`/`detect-sitemap`/
      `detect-agents-md`/`discovery`, and the `'route'` target in `write.test.ts`), generate-level
      recommendation + `emit` tests, and a new **`discovery` fixture** (ships robots.txt + a
      `sitemap.ts` + agents.md, exercised through a real `next build`). Live serving of the route
      target under `.well-known` is only verifiable on a real deploy — folded into the Phase 1 / 3.5
      Vercel step, same as the other deploy-only checks.

### 2.5 Drift detection (fold in here — it's nearly free)

- [ ] Diff newly generated catalog against the last committed one; print a human-readable diff in
      CI output. Informational only — never blocks, never judges.
- [ ] Golden-diff test: mutate one route in a fixture, assert the diff names exactly that change
      and nothing else.
- [ ] No execute-body hashing in v1 (documented as a possible later opt-in).

### 2.6 Tests for this phase

- [ ] Unit: config parsing/validation, URN generation, entry construction, denylist matching.
- [ ] Snapshot: run generation against every fixture; snapshot the emitted `ai-catalog.json`.
      Snapshot diffs in PRs are the main review surface.
- [ ] Invariant: every snapshot must also pass `validateCatalog` (a snapshot can never lock in an
      invalid catalog).

**Done when:** all fixtures generate validated, snapshotted catalogs through both emission targets;
drift diff runs in this repo's own CI.

### 2.7 Discovery-signal expansion — next up (added 2026-07-22)

Grounded in a 2026-07-22 call with Ora plus research (JSON-LD / OpenAPI / MCP server-card). These
widen the plugin's detect-and-recommend/emit surface to more artifacts Ora scores. Precision over
recall is unchanged: the plugin still only detects/recommends/emits what is unambiguous, and never
authors judgment content. **This is the immediate work.**

- [x] **OpenAPI — recommend when absent (extends Phase 3.1).** `detect-openapi.ts` is warn-only today
      (it references a committed `public/openapi.json`); add a recommendation on the advisory channel
      when no doc is present, mirroring robots/sitemap/agents.md. This is the highest-density single
      fix: one doc feeds `openapi-spec` (Discovery) **and** several Usability checks (`public-api-docs`,
      `api-schema-analysis`, `response-schema-coverage`, `function-calling-compat`). **Recommend, never
      build** — name the idiomatic Next.js path (`zod-openapi` / `@asteasolutions/zod-to-openapi` if the
      app validates with Zod; else `next-swagger-doc` / `next-openapi-gen`). Add a second message when a
      doc exists but declares no `components.securitySchemes` (nudge toward the auth declaration Phase
      2.8 reads). Telnyx (A+) confirms the pattern: a full committed OpenAPI doc. (`detect-openapi.ts`
      gained an optional `recommend` channel; wired through `generate.ts`.)
- [x] **JSON-LD — detect + recommend (new `detect-json-ld.ts`).** Ora scores structured data:
      `json-ld`, `org-schema-completeness`, `schema-type-breadth`, `json-ld-entity-linking`,
      `speakable-content` (Discovery). Telnyx ships 7 JSON-LD blocks incl. an `Organization` with a
      10-URL `sameAs` (LinkedIn/GitHub/Crunchbase/npm/socials) — `sameAs` is the entity-disambiguation
      signal registries value. Text-scan `app/**/{layout,page}.{tsx,jsx}` for `application/ld+json`;
      recommend adding an `Organization` block with `sameAs` when absent. **Detect-and-recommend only:**
      JSON-LD lives in rendered HTML (`<script type="application/ld+json">` in the layout), not a file
      the plugin emits, and the scoring fields (`sameAs`, address, logo, extra types) are
      external/judgment → the companion skill authors them (Phase 6). An opt-in scaffold of a minimal
      `Organization` component (name/url/description from `package.json`/`siteUrl`, empty `sameAs` +
      TODO) is possible but low-priority — the weakest fit, since the valuable fields aren't derivable.
- [x] **MCP — generate `/.well-known/mcp/server-card.json`.** Empirical finding (2026-07-22 Ora scan of
      a deployed `mcp-handler` server): a working MCP server moved the score **0 points** because Ora
      discovers MCP via the well-known **server card**, not the ARD catalog entry — `mcp-server-card`
      ("No MCP server card found at /.well-known/mcp/server-card.json") and `mcp-well-known-discovery`
      stayed failing while `ard-catalog` passed. So the plugin must *also* emit the card. Generate the
      **SEP-1649 / PR-2127** server card (media type `application/mcp-server-card+json`) from the mount
      the plugin already detects: `serverInfo` (from `package.json`), `transport`
      (`streamable-http`, endpoint = mount URL), `tools` (names — plus per-tool schema/description only
      when statically extractable, else `"dynamic"`). Optional compatibility alias at
      `/.well-known/mcp.json` (SEP-1649's original path). Emit as a static file or route handler per the
      existing `emit` target logic, governed by the same gating as catalog entries. **Auth on the card
      is deferred to Phase 2.8** — for now emit only statically-provable fields and **omit** the
      `authentication` block (never assert "open"). This is **not** issue
      `agentic-community/mcp-gateway-registry#119` (that proposes a different vendor's multi-server
      `/.well-known/mcp-servers` registry format — confirm the intended shape with Ora; see open
      questions). **Shape deviation (found 2026-07-26, from newer ground truth):** the plan's original
      `serverInfo`/`transport`/`tools[].input_schema` fields describe an *earlier* SEP-1649 draft. The
      current official MCP server card (`experimental-ext-server-card` `schema.json`) and the Ora-aligned
      `agent-ready.dev` validator both converge on the MCP-registry `server.json` shape — reverse-DNS
      `name`, `description`, `version`, `remotes[]` — and a 2026-07-22 scan-methodology note confirms
      Ora's `mcp-server-card` check awards full credit only when `name`/`description`/`version`/`serverUrl`/`tools[]`
      are all present. So the emitted card (`server-card.ts`) is the **union**: registry `name` +
      `remotes[]` for spec/registry compatibility, plus top-level `serverUrl` + `tools[]` for Ora.
      Precision over recall: no `$schema` URL is guessed and no `authentication` block is asserted (auth
      is Phase 2.8). Emitted via the same `emit` (static/route) logic as the catalog (`write.ts`
      `writeServerCard`); the card is gitignored fixture build output like the catalog.
- [x] Fixture + tests for each: OpenAPI-absent recommendation, JSON-LD detect/recommend, and a
      server-card emission fixture. Re-scan a deployed MCP fixture to confirm the `mcp-*` checks flip
      (the 0-point result becomes a measured win). (Unit tests per module + generate/cli wiring tests +
      the `discovery` fixture now ships a JSON-LD block and the `mcp-adapter` fixture emits a server
      card. The deployed re-scan remains a human/deploy step, like the other Vercel-only checks.)

**Done when:** the CLI recommends OpenAPI when absent, detects+recommends JSON-LD, and emits a valid
`/.well-known/mcp/server-card.json` that Ora's `mcp-server-card`/`mcp-well-known-discovery` checks
accept on a deployed fixture.

### 2.8 Gating & auth — deferred, but before the Phase 3.5 canary publish (added 2026-07-22)

Out of scope for the first demo, **but must be resolved before any public/canary publish**: emitting a
catalog entry or server-card that advertises a *gated* surface as open is the exact precision-over-recall
failure this project exists to prevent (agents hit blind 401s; a token prompt could leak into a public
crawl). Design converged 2026-07-22; grounded in research on OpenAPI `securitySchemes`, MCP SEP-1649/2127,
and how Clerk actually gates routes.

- [ ] **Detection-first, per-kind — never infer, never guess.** Each artifact carries its own native
      auth-declaration; read the right one per kind:
      - MCP → detect the `withMcpAuth` / `verifyToken` wrapper and/or a served
        `/.well-known/oauth-protected-resource` (RFC 9728) route → mark gated; read `withMcpAuth`'s
        `resourceMetadataPath` (a literal) to cross-link it in the server card. (Clerk's official MCP
        path uses exactly `withMcpAuth` + RFC 9728, so this is ecosystem-idiomatic.)
      - OpenAPI/REST → read `components.securitySchemes` + the effective `security` from the committed
        doc → a compact, **secret-free** `auth` descriptor (`apiKey` / `http-bearer` / `oauth2` /
        `openIdConnect`). Emit only URLs/names/scope-keys; a **secret-guard** rejects token/key-looking
        values; skip `description` prose.
- [ ] **Safe default:** a detected auth signal → the artifact is not advertised as open. **Never infer
      "open" from the absence of a signal** (auth may sit in middleware, a reverse proxy, a WAF, or
      Vercel Deployment Protection — none statically visible).
- [ ] **Escape hatch:** optional `isGated?: (target: { kind: 'mcp' | 'openapi' | 'entry'; path: string;
      tools?: string[] }) => boolean` in `ard.config` for infra auth the plugin can't detect. Boolean,
      whole-artifact for v1. **Not** built on reusing Clerk's `createRouteMatcher` — that API is
      deprecated and has a bypass CVE (GHSA-vqx2-fgx2-5wq9), and Clerk differentiates MCP-vs-API by auth
      *mechanism* (OAuth bearer vs session cookie), not by a shared path matcher.
- [ ] **Backstop = review-before-publish (Phase 2.3).** Surface the exposure surface and require `--yes`
      in CI before writing; flag `withMcpAuth`-vs-`isGated` disagreements. **This means Phase 2.3 must
      also land before Phase 3.5.**
- [ ] **Config cleanup:** `isGated` supersedes `denylist`/`allowlist` (a matcher subsumes both; there is
      no over-exclusion for an allowlist to undo). Breaking pre-1.0 config change → migrate the
      `config-overrides` fixture + README. No agentic-auth descriptor modeling in v1 — deferred until
      agentic auth is common.

**Done when:** no artifact (catalog entry or server-card) for a detected/declared-gated surface is ever
advertised as open; review-before-publish gates the ambiguous case; and this lands before the canary.

---

## Phase 3 — OpenAPI: reference the app's `public/openapi.json`

Goal (v1): reference a static `public/openapi.json` as one `application/vnd.oai.openapi+json` catalog
entry (the Telnyx shape). The plugin does **not** invent a schema convention or synthesize a doc from
route handlers — converting Zod → OpenAPI is a library's job (`@asteasolutions/zod-to-openapi` 2.3M/wk,
`zod-openapi` 881K/wk, `next-swagger-doc`, `next-rest-framework`); however the doc gets produced, if it
lands at `public/openapi.json` the plugin references it.

### 3.1 Reference the doc

- [ ] Detect `public/openapi.json`; reference `/openapi.json` (respecting `basePath`). Parse it and
      confirm it is OpenAPI 3.x; warn (never fail) if it doesn't parse.
- [ ] Emit one `application/vnd.oai.openapi+json` entry with the URL, `updatedAt`, and a short
      description / representative operations read from the doc.
- [ ] Negative: an app with plain route handlers and no `public/openapi.json` emits **no** OpenAPI
      entry (precision over recall).

### 3.2 Later (not v1)

- [ ] Reference an OpenAPI doc served from a **route** (`app/openapi.json/route.ts`, a
      `next-rest-framework` docs route, …) by URL — the postbuild CLI can't execute the route, so it
      would reference the path without reading contents.

### 3.3 Tests

- [ ] `openapi` fixture (static `public/openapi.json`) → one entry referencing `/openapi.json`,
      validated as OpenAPI 3.x.
- [ ] Negative: an app with plain route handlers and no doc emits **no** OpenAPI entry.

**Done when:** the `openapi` fixture produces a single correct `application/vnd.oai.openapi+json` entry,
and an app without a doc produces none.

---

## Phase 3.5 — First npm publish (canary) — *makes the real Vercel workflow adoptable*

Goal: graduate from the interim **committed-tarball** mechanism (a `pnpm pack` `.tgz` referenced via
`file:` inside a demo repo — fine for the first Vercel deploy, but not something a real user can
adopt) to a genuinely installable package on the npm registry under the **`canary`** dist-tag. This
is the smallest publish that makes the intended workflow real — *add one dependency, deploy on Vercel,
watch the Ora score* — for Ora's own site and 1–2 friendly partners, ahead of a public `latest`. Full
release engineering (strict semver, changesets, docs, `latest`) stays in Phase 6; this phase does only
the minimum to ship a canary.

**Prerequisite — resolve open question #7 first** (package name / npm scope / who owns publish
rights). You cannot publish without a decided, available name: check `npm view ora-catalog` and, if
it's taken, fall back to a scope (e.g. `@ora/catalog`).

- [ ] Secure the name: create the npm account/org; verify the name is free or claim the scope.
- [ ] Minimal publish config: confirm the `files` allowlist (`dist` only) and `publishConfig`
      (`access: public` if scoped); enable **npm provenance** on publish. (`package.json` already
      carries `files: ["dist"]` and a `publishConfig` block.)
- [ ] Version + tag: publish a prerelease (e.g. `0.1.0-canary.0`) under the **`canary`** dist-tag, so
      a plain `npm install ora-catalog` (default `latest`) never resolves an unfinished build — only
      an explicit `ora-catalog@canary` does.
- [ ] **Verify the real workflow end-to-end:** in a scratch Next.js template *outside* this repo,
      `npm install ora-catalog@canary`, add the `postbuild` script, deploy on Vercel, and confirm the
      catalog serves at `/.well-known/ai-catalog.json`. Then scan the production domain with Ora's
      `agent-ready-website` skill and record the score. (Same manual loop Phase 1 left open — now
      driven through the published package instead of a tarball.)
- [ ] Document the `@canary` install + Vercel `postbuild` in the README as the current adoption path.

**Done when:** `ora-catalog@canary` installs cleanly into an external template, a Vercel deploy serves
a valid catalog at the well-known URL, and Ora scans it. The public `latest` release is Phase 6.

---

## Phase 4 — WebMCP detection

Goal: detect in-page WebMCP tools and include them in the same catalog. Goes late deliberately —
WebMCP is a W3C Community Group draft, behind a flag in Chrome, least-stable dependency.

**Implemented 2026-07-27** (`src/detect-webmcp.ts`), with three deviations from the plan as
written, each driven by fresh ground truth:

- **The entry point moved.** The May 2026 draft moved WebMCP from `navigator.modelContext` to
  `document.modelContext` (Chrome 150+ deprecates the `navigator` alias). The detector recognizes
  `document`/`navigator`/`window` receivers and **warns on the deprecated `navigator` form**; the
  `webmcp-imperative` fixture was updated to the current API and `edge-cases` deliberately keeps a
  `navigator` case to exercise the warning. Also detected: `provideContext()` batch registration
  and the `useWebMCP()` hook (`@mcp-b/react-webmcp` / `usewebmcp` — import + call, two signals).
- **Textual detection, not AST** — extending the `detect-mcp.ts` precedent instead of the planned
  AST pass; the `modelContext` receiver (or hook import+call pair) provides the same
  false-positive resistance the AST was for, including the user-defined-`registerTool` decoy and
  `<form toolname>` *mentions* inside string literals.
- **Emission split by what's real:** declarative `<form toolname>` tools on statically-addressable
  pages become `text/html` entries with `capabilities` (the page is a real artifact); imperative
  tools have **no spec-defined manifest** (confirmed: the explainer rejects static manifests;
  `.well-known/webmcp.json` is vendor convention, not spec), so they surface via the build
  summary/recommendations — never invented entries.

- [x] Declarative detector first (near-trivial, high-confidence): JSX `<form toolname=...>`.
- [x] Imperative detector: `modelContext.registerTool(...)` call expressions in `'use client'`
      files (textual, receiver-anchored — see deviation above).
- [x] Warn on `registerTool` in a server component (and on the deprecated `navigator` entry point).
- [x] Negative detection: user-defined `registerTool` functions must not match (fixture exists).
- [x] **No WebMCP skill inference, no `defineSkill` invention.** If/when WebMCP standardizes skills,
      add a detector then. (Distinct from the `application/ai-skill+md` *agent-skills-repo* detection
      in 2.2 — that's a real artifact Ora indexes, not an invented WebMCP spec point.)
- [x] Tests: unit suite (`test/detect-webmcp.test.ts`) + fixture integration for
      `webmcp-imperative`, `webmcp-declarative`, `edge-cases` (zero false positives asserted).

**Done when:** both WebMCP fixtures emit correct entries; edge-case fixture emits zero false
positives. ✓ (Note for Ora: their `webmcp` check reads only server-rendered homepage HTML, so
imperative client-side tools score 0 there, and their `webmcp` recommendation text describes a
remote-MCP transport rather than the browser API — both reported upstream, see 2026-07-27 notes.)

### Phase 4.5 — Agent-aware 404 + machine-readable report (added 2026-07-27)

Two additions shipped alongside Phase 4, both following existing conventions:

- [x] **Agent-aware 404** (`src/agent-404.ts`, `ard.config` `scaffoldAgent404`, default `false`).
      Detect `app/not-found.*`; recommend agent signposts when absent/bare. Opted in: scaffold an
      agent-aware `not-found.tsx` **once** (user-owned, never overwritten) importing a data module
      (`app/not-found-agent-data.*`) **regenerated every build** with the static route list
      (dynamic segments never guessed) and discovery links (catalog / llms.txt / sitemap — only
      artifacts that exist). Grounding: Vercel's agent-readability guidance (llms.txt signposting,
      `Link` headers) and Mintlify's benchmark that one llms.txt link on responses eliminates most
      agent 404 dead-ends. Middleware-based content negotiation (markdown 404s for
      `Accept: text/markdown` / `Signature-Agent` requesters) is a documented follow-up — writing
      into a user's singleton `middleware.ts` is too invasive to scaffold today.
- [x] **Machine-readable build report** (`src/report.ts`; `--report[=path]` / `ard.config`
      `report`, default off; default path `.ora/report.json`). The structured twin of the CLI
      output: entries + written paths, MCP mounts + server card, WebMCP sites, per-artifact
      presence, agent-404 status, warnings/recommendations verbatim. Turns the plugin's stdout
      recommendations into something a coding agent consumes directly.

---

## Phase 5 — Evals & hardening

Goal: prove the output is *usable by agents*, not just spec-valid, and lock in cross-version safety.

### 5.1 Consumption evals — two tiers with explicit cadence

- [ ] **PR tier (deterministic, every PR):** scripted agent loop — fetch catalog → parse → select
      tool for a task → construct a call from the extracted schema → assert validity. No LLM, no
      flake, no cost.
- [ ] **Nightly/release tier (real LLM):** same tasks driven by an actual model; graded on explicit
      metrics — tool-selection accuracy and valid-call rate — with thresholds, not vibes. Runs on
      schedule and before releases only, so cost/flake never gets the evals deleted.
- [ ] **Prefer AgentJourney (journey.ora.ai) as the real-LLM harness:** it already runs a real
      agent against a domain with a goal — exactly this eval. Ask Ora for API access; run deployed
      fixtures through it nightly and track the readiness rating as the eval metric. Fall back to
      a bespoke harness only if no API exists. Bonus: the plugin is then evaluated by the same
      system Ora's customers are scored by — no metric drift between "passes our evals" and
      "scores well on Ora."
- [ ] Eval findings that reveal weak descriptions/metadata feed back into what the plugin emits.

### 5.2 Cross-version safety

- [ ] CI matrix: full fixture suite against every supported Next.js minor (pinned create-next-app
      versions).
- [ ] Ecosystem canary: scheduled CI job against `next@canary`; alerts (never fails PRs) on
      breakage — know before users do.

### 5.3 Regression discipline

- [ ] Every real-world bug report becomes a fixture before it's fixed. Non-negotiable.

**Done when:** PR-tier evals gate merges; nightly tier reports metrics; version matrix green.

---

## Phase 6 — Release engineering & docs

- [ ] Strict semver: catalog output changes ≥ minor; breaking config changes = major; spec-version
      bumps called out explicitly in release notes.
- [ ] Changesets for changelogs; catalog snapshot diffs double as honest release notes.
- [ ] Dist-tags: the `canary` line (first cut in Phase 3.5) is what Ora's own site + 1–2 friendly
      partners run; Phase 6 **promotes a proven canary to `latest`**. With near-zero ecosystem
      adoption of the spec, these first users are the real integration test.
- [ ] Docs generated from fixtures (guaranteed-working examples): quickstart, artifact detection
      (MCP/OpenAPI/docs/skills), config reference, denylist/security defaults, drift-diff reading
      guide, `basePath`/deployment
      notes, degradation policy.
- [ ] Developer-facing **companion skill** (SKILL.md) for coding agents — a thin, Next-specific layer
      that **composes with Ora's own `agent-ready-website` skill** rather than duplicating its
      scan→fix→rescan loop. Owns the judgment/authoring half the plugin refuses to guess: authoring
      `llms.txt` and `agents.md` content from the repo, drafting `representativeQueries` / entry
      descriptions / `capabilities`, advising the robots.txt allow-and-pointer policy, and explaining
      the sitemap (delegate to `next-sitemap`). Defers to Ora's skill for the score scan and for the
      runtime API-behavior fixes (rate-limit headers, idempotency, JSON errors) the build-time plugin
      can't emit. Written last, once the config surface stabilizes.
- [ ] Supply-chain: npm provenance on publish, lockfile committed, dependency count reviewed before
      v1 (target: near-zero runtime deps).

**Done when:** v1 success criterion met (Ora + partners indexed) and `latest` published.

---

## Open product questions for Ora (resolve in Phase 0.1)

| # | Question | Recommendation | Decision |
|---|----------|----------------|----------|
| 1 | Pages Router in v1? | No — App Router only | _pending_ |
| 2 | How does the plugin handle a Next app's REST API? | **Resolved:** reference a static `public/openapi.json` if present — the plugin invents no schema convention and synthesizes nothing from route handlers. Serving the doc from a route is a later add. Per-route "tool" entries dropped. | **resolved** |
| 3 | Default denylist + review-before-publish on by default? | Yes — registry quality depends on it | _pending_ |
| 4 | Schema strategy: evaluate exported schemas vs parse AST? | Evaluate (subprocess) | _pending_ |
| 5 | Drift diff ships in v1? | Yes, informational-only (it's nearly free) | _pending_ |
| 6 | Emission default: static file vs route handler? | Static file default, route handler for `basePath` | _pending_ |
| 7 | Package name / npm scope / who owns publish rights? | — | **Resolved (2026-07-27):** `@ora-ai/ax`, CLI bin `ax` — "AX" (Agent Experience) is the product story; scoped name avoids npm collisions. Publish rights: Ora's npm org (create `@ora-ai` if absent). Repo/fixture scopes renamed accordingly (`@ax-fixtures/*`). |
| 8 | Real-LLM eval budget + which model/provider? | Nightly + pre-release only | _pending_ |
| 9 | Timeline expectations per phase? | Skeleton wk 1; Phases 2–3 are the bulk | _pending_ |
| 10 | Which artifacts should the plugin emit/reference? | **Resolved (2026-07-16):** Ora confirmed the crawler ingests the first-party `/.well-known/ai-catalog.json`, `openapi.json`, `/graphql`, and `llms.txt`. The plugin emits the Next-idiomatic subset — MCP + `public/openapi.json` + config-declared docs/skills now; WebMCP + `llms.txt` generation next; **GraphQL out** (not idiomatic Next). Sitemap = detect + recommend `next-sitemap`, don't reimplement. | **confirmed** |
| 11 | API access to AgentJourney (journey.ora.ai) for automated evals? | Yes — use it as the nightly real-LLM eval harness | _pending_ |
| 12 | Does Ora's crawler/scorer use an internal ai-catalog schema or validator? | **Resolved (2026-07-19):** the ARD spec now publishes an official JSON Schema + conformance CLI (ards-project/ard-spec) — vendored in `spec/ard/` as the strict emission oracle and run in CI. Remaining sub-question for Ora: do they validate with the official tool too, or something stricter? | **resolved** |
| 13 | Is the agent-readiness score essentially a **checklist of artifact types** (OpenAPI / MCP / GraphQL / llms.txt / docs / skills)? Top-site data suggests breadth drives the grade. | If yes, target the checklist directly and report per-artifact coverage in the build summary. | _pending_ |
| 14 | Which entry fields should a first-party catalog self-declare? (`auth`, `capabilities`, `representativeQueries`, `provenance`, `trustManifest.attestations`) | **Partly resolved by the spec (2026-07-19):** `capabilities` / `representativeQueries` / `trustManifest` are first-class ARD fields, not Ora extensions — `representativeQueries` (2–5 items) drives registry search embeddings, so it's plainly worth self-declaring; supported via `ard.config` `entries`. `capabilities` emitted zero-config for MCP. Only `auth` / entry-level `provenance` are true extensions — confirm with Ora how they weigh those. | _mostly resolved_ |
| 15 | Agent **skills** (`application/ai-skill+md`): does Ora expect skills in a published GitHub repo, and should the plugin help scaffold/reference one? | Detect-and-reference a skills repo if present; do not invent skills. Scaffolding = later. | _pending_ |
| 16 | Once the skill's `api-catalog`→`ai-catalog` bug is fixed, do the **registry crawler and the score scanner** both key on ARD `/.well-known/ai-catalog.json`? | Confirm they agree — the plugin's headline output depends on it | _pending (Ora aware of the skill bug 2026-07-22, fix expected)_ |
| 17 | What `User-agent` token does **Ora's crawler** send? | Needed to detect a blocking robots.txt and to author the scoped `Allow` recommendation | _pending_ |
| 18 | Does the plugin/companion skill scope include `agents.md` content and the robots.txt policy, or does Ora expect those from its own `agent-ready-website` skill? | Plugin detects/scaffolds structure; companion skill authors content and defers to Ora's skill for the scan loop | _pending_ |
| 19 | Confirm the **MCP server-card path/schema** Ora's `mcp-server-card` check expects: SEP-1649/PR-2127 `/.well-known/mcp/server-card.json` (media type `application/mcp-server-card+json`)? The contact cited `agentic-community/mcp-gateway-registry#119`, but that issue is a *different* vendor's multi-server `/.well-known/mcp-servers` registry format — likely a miscitation. Also: should we emit the `/.well-known/mcp.json` alias (SEP-1649's original name)? | Build the SEP-1649/2127 server card (matches the path Ora already probes); alias `mcp.json` if it helps clients | **Empirically pinned (2026-07-22, tunnel scans of a deployed `mcp-handler` server):** `mcp-server-card` **passes** on the plugin's generated card at `/.well-known/mcp/server-card.json` (found + accepted). But **`mcp-well-known-discovery` never extracts the server URL and all runtime `mcp-*` checks stay `na` ("No MCP server detected")** — unchanged across `serverUrl`/`remotes`/`transport.endpoint` field shapes, with a `/.well-known/mcp.json` alias also present, and with a live endpoint that answers `initialize`. So Ora's MCP *discovery* is **decoupled** from the server-card and uses an undocumented mechanism. Caveat: tested on a `*.trycloudflare.com` tunnel (the `mcp-server: pass` was a Cloudflare brand false-positive), so discovery may not run truthfully off a real domain — **re-test on the Vercel deploy.** Open for Ora: how does `mcp-well-known-discovery` find the URL, and does it connect on non-registered domains? |
| 20 | Should Ora's **MCP discovery consume the ARD catalog's `application/mcp-server-card+json` entry**? Empirically (2026-07-22 scan) Ora validates the catalog (`ard-catalog: pass`) but ignores it for MCP discovery — it only reads `/.well-known/mcp/server-card.json`, so a real MCP server scored **0**. If discovery consumed the catalog entry, the plugin's existing output would already work. | Ideally yes — otherwise the plugin must emit the well-known card too (Phase 2.7) | _pending_ |
| 21 | Which **auth shape** does Ora reward, and where does it read it — OpenAPI `securitySchemes`, the server-card `authentication` block, or RFC 9728 `/.well-known/oauth-protected-resource`? Drives Phase 2.8. | Read the native per-kind declaration (securitySchemes for REST, `withMcpAuth`+RFC 9728 for MCP); confirm Ora's weighting | _pending_ |

---

## Sequencing logic (why this order)

Fixtures → skeleton → catalog core → OpenAPI detection → first canary publish → WebMCP → evals,
ordered by risk-of-rework: the skeleton de-risks the untested Ora-crawler integration in week one; the
catalog core — centered on **detect-and-reference** of the Next-idiomatic artifacts (MCP,
`public/openapi.json`, config-declared docs/skills) — is stable regardless of spec churn and is the
cheapest high-value work; OpenAPI detection reuses the same detect-and-reference machinery; the first
canary publish (Phase 3.5) comes once that core is real, so partners can adopt the intended Vercel
workflow before the least-stable work lands; WebMCP depends on the least-stable spec so it goes late;
evals only make sense once there's real output to consume.

**If timelines compress:** the shippable, useful v1 is **detect-and-reference alone** — site metadata
+ MCP-server detection + a `public/openapi.json` + config-declared docs/skills + `llms.txt`. That
already improves a site's Ora score. WebMCP discoverability is the near-future add; LLM-tier evals are
a first cut.
