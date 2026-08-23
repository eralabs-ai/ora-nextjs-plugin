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
  duplicated in `ax.config.ts` (the `next-sitemap` model).

---

## Scope

The plugin helps Next.js full-stack apps — which already configure APIs and MCP servers the Next.js
way — become discoverable to agents, generating an ai-catalog from what the app already has.

**In scope (v1):**

- MCP servers configured the Next.js way (`mcp-handler`) → `application/mcp-server-card+json`.
- A static `public/openapi.json` → `application/vnd.oai.openapi+json`.
- A configurable way for the developer to declare where their **docs** and **skills** live (URLs in
  `ax.config`) → `text/html` / `application/ai-skill+md` entries.
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
(supported via `ax.config` `entries`) directly improves discoverability, not just Ora's score.
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

## Vercel strategy sync (added 2026-08-16 — opened the runtime track)

We synced with Vercel on the plugin's strategy for agent-facing serving (2026-08-16). The
alignment settled the runtime direction and a set of engineering invariants; this section records
the agreed steps forward in enough detail that Phases 7–10 are implementable as written, without
further context.

**The agreed serving model:** three jobs at HTTP time — *detect* AI agents from request headers,
*serve* them markdown via composable middleware, and let a black-box *audit* verify the deployed
result. The runtime layer must be zero-dependency and Web-API-only (Edge-safe). The division of
labor is the key alignment: **the build step generates and knows; the runtime negotiates.** A
middleware alone cannot know a site's route table, which artifacts exist, or which surfaces are
gated — that knowledge is exactly what our postbuild step derives, so our runtime consumes a
build-generated manifest instead of guessing.

**Aligned engineering invariants (each with the reason it exists):**

- **The agent/bot detection corpus** — four data sets, maintained together as one module with a
  recorded review date so staleness is visible (sources: bots.fyi + official vendor bot docs;
  last cross-reviewed 2026-03-20): (1) ~31 lowercase AI-agent UA substrings grouped by vendor
  (Anthropic: claudebot / claude-searchbot / claude-user / anthropic-ai / claude-web; OpenAI:
  chatgpt / gptbot / oai-searchbot / openai; Google AI, Meta, search/research AI, coding
  assistants, plus amazonbot / ai2bot / diffbot / bytespider / omgili(bot)); (2) known
  `Signature-Agent` domains (currently only `chatgpt.com`); (3) a 19-entry traditional-bot
  exclusion list (googlebot, bingbot, social-preview and uptime monitors — bots that must keep
  receiving user HTML: the **cloaking firewall**); (4) a bot-like UA regex
  (`/bot|agent|fetch|crawl|spider|search/i`) used only by the heuristic layer.
- **Detection is a 3-layer cascade:** UA-substring match (suppressed when the request is a real
  browser document navigation — `sec-fetch-mode: navigate` + `sec-fetch-dest: document` — so
  agent-embedded browsers like Cursor's, whose UA contains "cursor", still get HTML), then
  `Signature-Agent` (RFC 9421), then a heuristic (no `sec-fetch-mode` at all + bot-like UA + not
  a traditional bot). Posture for serving: **recall over precision** — mis-serving markdown to a
  non-agent is low-harm.
- **Two response-header invariants on every negotiated markdown response:** `Vary: Accept`
  appended with *token-level* dedup (split the existing Vary on commas; never substring-match),
  and `Link: <url>; rel="canonical"` added only when no canonical Link already exists (markdown
  has no `<link rel="canonical">` equivalent — this header is the only attribution mechanism).
  Without Vary, CDNs cache the wrong variant; without the canonical Link, crawlers index markdown
  twins as duplicate pages.
- **Middleware composes, never owns.** The runtime entry is a higher-order function that wraps
  the user's existing middleware (Clerk-style) instead of owning `middleware.ts`. `onDetection`
  analytics are armored — sync throws swallowed, promises passed to `event.waitUntil()` — so
  telemetry can never break serving. A recommended `matcher` excludes `_next`, `api`, static
  files, favicon/robots/health/status.
- **No blind rewrites.** A Next.js middleware has no cheap way to check that a rewrite target
  exists (no zero-hop internal fetch primitive), so a rewrite fired on a guessed path serves
  agents broken responses. Agreed fix, and our structural advantage: the middleware only rewrites
  paths the **build-generated manifest** lists as having a markdown target (Phases 9–10).
- **The 404 doctrine:** agents discard 404 response bodies, so a missing-page request from a
  detected agent should get a **200 + markdown wayfinding body** (links to the discovery
  artifacts and real routes) while plain clients keep the honest 404 — the pair only passes
  together on genuinely negotiation-aware error handling. The 200-for-agents move is legitimate
  *only* for 404s (a dead end with no honest next step); a gated route has an honest next step,
  so auth walls keep truthful 401/403 (see Phase 9's gated policy).
- **Ship the companion skill inside the npm tarball** (`files` allowlist gains a `skill/` dir) —
  the package documents its own installation to the coding agents that install it. Adopted for
  Phase 6.
- **Audit checks are acceptance criteria, not our scanner.** The black-box audit funnel
  (reach → find → read → parse: soft-404 truthfulness, auth gates, redirect hygiene, llms.txt
  format/size/link integrity, markdown retrieval via UA / Accept / `.md` URLs, frontmatter, code
  fences, page size) is scanner territory — Ora's, not ours. Our relationship to those checks is
  emission-side: everything ax generates should be **born passing them** (Phase 7), and the
  negotiation-dependent ones (Vary, agent-404 markdown, canonical Link) should pass **by
  construction** once the middleware ships (Phase 10). Live auth-gate *detection* (401/403 counts
  + login-page fingerprints) is the scanner-side complement of what our `isGated` (Phase 2.8)
  prevents at emission time.

**What this changes in the plan:** the middleware follow-up deferred in Phase 4.5 ("writing into a
user's singleton `middleware.ts` is too invasive to scaffold today") is unblocked — the
compose-never-own pattern means we never need to own that file. Four new phases: **Phase 7**
(serving-correctness groundwork — header helper, detection corpus, born-passing tests), **Phase 8**
(`ax init` onboarding wizard), **Phase 9** (markdown twins + generated markdown artifacts + the
route/serving manifest + the gated-surface policy), **Phase 10** (the `@ora-ai/ax/middleware`
runtime entry).

**What this does NOT change:** posture. *Recall over precision* is correct for **serving** (a
mis-served markdown variant is low-harm and reversible), while *precision over recall* remains
correct for **emission** (a published claim isn't). The runtime layer adopts the serving posture
without loosening the emission one — the two coexist because the stakes differ by layer, and
Phase 10 documents the distinction explicitly.

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

- [x] Next.js: App Router **and** Pages Router (and both at once). Detection and scaffolding run
      through a single `RouterModel` port (`router-model.ts`) composing an App adapter (`app-dir.ts`)
      and a Pages adapter (`pages-dir.ts`); output artifacts stay router-agnostic under `public/`.
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
- [x] `config-overrides` — app with an `ax.config.ts` declaring entries plus denylist/allowlist
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

> **Renamed `ard.config` → `ax.config` (2026-07-27, per Ora's decision).** The bullets below now
> refer to `ax.config` throughout; what shipped is `ax.config.{ts,mts,cts,mjs,js,cjs}`, typed with `AxConfig`
> and failing loudly via `AxConfigError`. This supersedes the vendor-neutrality rationale recorded
> below — the file is now named after the `ax` tool that reads it, so a file committed into a
> consumer's repo says which tool it configures. A legacy `ard.config.*` still loads, with a
> deprecation warning; when both exist the `ax.config.*` wins and the `ard.config.*` is ignored
> (also warned). `ArdConfig` / `ArdEntryOverride` / `ResolvedArdConfig` / `ArdConfigError` /
> `loadArdConfig` / `validateArdConfig` / `ardConfigSchema` remain exported as deprecated aliases,
> so existing imports keep resolving.

- [x] `ax.config.{ts,mts,cts,mjs,js,cjs}` — typed config, validated via JSON Schema through the
      existing Ajv instance (not Zod — see *decision* below), loaded via the CLI. (Originally named
      `ard.config` — "Agentic Resource Discovery", vendor-neutral for eventual upstreaming into
      Next.js; renamed 2026-07-27 to `ax.config` after the tool that reads it, so a file committed
      into a consumer's repo names which tool it configures. See the 2.1 rename note above; the
      legacy `ard.config.*` still loads with a deprecation warning.)
- [x] Load the user's `next.config.*` (js/mjs/ts) and extract `basePath`, `distDir`, and `output`
      so users never repeat Next settings in plugin config. Handle both object and function-form
      configs; on load failure, warn and fall back to defaults (never crash over their config).
      (`src/next-config.ts`, loaded via `jiti` — the one new runtime dependency this needs, since
      Node can't natively `import()` a `.ts` config file itself.)
- [x] Test next-config loading against the `deploy-variants` and `monorepo` fixtures.
      (`test/fixtures-integration.test.ts`.)
- [x] Build-time validation fails loudly with actionable messages on invalid config.
      (`AxConfigError`, caught in `cli.ts` and reported without a stack trace.)
- [x] Config **overrides/extends** inferred entries; it never silently replaces them.
      (`src/entries.ts` `applyEntryOverrides` — merges by `identifier`, appends otherwise.)
- [x] Denylist support, with a default-on denylist (`/api/auth/**`, `/api/webhooks/**`); allowlist
      to re-include. (`src/denylist.ts`.)


### 2.2 Zero-config inference & artifact detection (aligned with Ora's index)

Detect-and-reference is the cheapest, highest-value work — it mirrors exactly what Ora's crawler
already rewards. Zero-config, in rough priority order:

- [x] Emit site-level metadata (name + domain from package.json / config). Domain can
      now also come from `ax.config`'s new **`siteUrl`** (see below), not just Vercel's env var.
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
      developer **declares in `ax.config`**. Config-driven, not guessed — the developer knows
      where their docs and skills live; the plugin doesn't spider for them. (Already covered by the
      generic `entries` override mechanism from 2.1 — see the `config-overrides` fixture, which
      already declares exactly this shape. No new config surface needed.)
- [x] Reference an existing **`llms.txt`** served the Next.js way — a route handler at
      `app/llms.txt/route.ts` (often `dynamic = 'force-static'`) or a static `public/llms.txt` →
      `text/markdown`. Scaffold a starter route handler when absent (v1; cheap, idiomatic).
      (`src/detect-llms-txt.ts`. **Deviation from the plan as written:** scaffolding is **opt-in**
      via `ax.config`'s `scaffoldLlmsTxt: true`, defaulting to `false` — writing a *second* file
      into a consumer's `app/` directory is a bigger, unsolicited source-tree mutation than the one
      catalog file this plugin exists to produce, and an opt-out default is too easy to miss for a
      build tool meant to run unattended across many sites. This was found empirically: with an
      opt-out default, this repo's own test suite silently scaffolded files into four unrelated
      fixtures the first time it ran. **Update (2026-07-27):** the scaffold no longer writes a
      placeholder — it derives real starter content (site name, description, the app's static
      routes, and the artifacts this build generated), so the file is useful the moment it lands.)
- [x] Do **not** synthesize an OpenAPI doc from bare route handlers; reference only a doc the app
      actually produces. Most route handlers are internal BFF endpoints and must not be exposed.
- [x] Do **not** emit GraphQL entries — out of scope (see *Scope*).
- [x] **Detector-precision prepass (`src/scrub-source.ts`, added 2026-07-27).** The textual
      detectors (`detect-mcp`, `detect-webmcp`) match API call patterns with regexes, which can't
      tell a real call from a *mention* in a comment or a template-literal body — those mentions
      were reaching the output as phantom tools/endpoints (a precision loss). `scrubSource` blanks
      `//` and `/* */` comments and template-literal contents while preserving offsets and line
      numbers (so match indices are unchanged) and deliberately leaves ordinary `'…'`/`"…"` strings
      intact (detectors legitimately read tool names / JSX attribute values from them, guarded
      per-line). `registerTool`/`provideContext` now also require a non-empty argument list.
      Regression-tested against the cases that previously misfired.

**New config surface added to support the above:** `ax.config`'s `siteUrl` — an explicit absolute
origin (e.g. `https://example.com`). The catalog schema's `url` fields require an absolute URI
(`format: uri`), so every detector above needs a known site origin to build one; without `siteUrl`
(and without Vercel's build-time `VERCEL_PROJECT_PRODUCTION_URL`), a detector still runs but skips
emitting its URL-bearing entry — with a warning — rather than emit a relative or guessed URL.
Precision over recall, applied to the plugin's own output, not just to what it detects.

### 2.3 Review-before-publish flow

- [x] First run (no committed catalog present): print a full "about to expose" summary and write
      the catalog only after `--yes` / interactive confirm; CI mode requires the flag. (`cli.ts` —
      `--yes`/`--dry-run` flags, an "About to expose" per-entry summary that flags each entry's
      `auth` status, a first-publish gate that refuses in non-interactive shells without `--yes`
      and prompts via `node:readline` interactively, and skips entirely once a catalog already
      exists at the target path. Fixture `postbuild` scripts now pass `ax --report --yes`.)
- [x] Every run prints a build summary; warnings are aggregated into the summary line
      (`✓ N entries referenced, K warnings`) rather than only printed individually.

### 2.4 Emission targets

- [x] Static file into `public/.well-known/` (default). (`src/write.ts` — the Phase 1 target.)
- [x] Alternative: generate a route handler (`app/.well-known/ai-catalog.json/route.{ts,js}`) for
      `basePath`/proxy setups — also the future path to dynamic catalogs. Opt in via `ax.config`'s
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
      Also noted:
      `MetadataRoute.Robots` (`app/robots.ts`) has no field for the `Agentmap:` pointer, so that line
      is recommended for a static `public/robots.txt`.
      **Update (2026-07-27): opt-in auto-write now ships (`scaffoldRobots: true`, default `false`),
      `src/scaffold-robots.ts`.** It is deliberately narrow: it only writes the two machine-readable
      pointers ax is uniquely placed to know — `Sitemap:` for a sitemap it actually detected and
      `Agentmap:` for the catalog it just generated — plus `Allow` blocks for reputable AI crawlers.
      An existing `public/robots.txt` is *appended to* (a marked block, only the missing lines,
      idempotent on re-run), never rewritten; an `app/robots.ts` route handler is never touched (it
      owns the policy in code). It never *blocks* a crawler on the owner's behalf — that policy call
      is shown commented-out. The still-pending crawler user-agent (open question #17) only affects
      which specific agents to name in the `Allow` block, not the safe pointers-and-allow shape.
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
      external/judgment → the companion skill authors them (Phase 6).
      **Update (2026-07-27): the opt-in scaffold now ships (`scaffoldJsonLd: true`, default `false`),
      `src/scaffold-json-ld.ts`.** It writes an `Organization` component **once** (name/url/description
      from `package.json`/`siteUrl`, `sameAs` left empty with a TODO — those links live outside the
      repo, so nothing at build time can derive them). ax deliberately does **not** wire the component
      into `app/layout.tsx` — editing the file every page renders through, behind the owner's back, is
      not a postbuild step's call — so the CLI (and the build report) print the exact import + element
      to add instead.
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
      **Update (2026-08-23): multi-server hosts + path divergence, verified before changing anything.**
      Phase 9 demo testing (a real app with a public `/api/public/mcp` and a `withMcpAuth`-gated
      `/api/mcp`) showed ax skipped the card entirely with >1 mount ("publish one by hand") — designed
      against an older draft. Both moving targets were re-verified on 2026-08-23:
      1. **SEP-2127** (superseded SEP-1649; PR modelcontextprotocol/modelcontextprotocol#2127, still
         OPEN, last updated 2026-08-20) has moved *again*: the `/.well-known/mcp-server-card/{name}`
         scheme from the interim draft is gone. The current revision hosts cards at any URI with
         `<streamable-http-url>/server-card` as the recommended location, and does domain-level
         multi-server discovery via an **AI Catalog at `/.well-known/ai-catalog.json`** (the
         `experimental-ext-server-card` repo owns the schema + `docs/discovery.md`).
      2. **Ora's `mcp-server-card` check** (live `list_checks`, 2026-08-23) still probes
         `/.well-known/mcp/server-card.json` — the path ax already emits.
      Since Ora's probed path is load-bearing for the score and *every* draft path has churned, ax
      keeps the Ora namespace and extends it: the **primary** server's card stays at
      `/.well-known/mcp/server-card.json`, and every server's card also lands at
      `/.well-known/mcp/server-card/<server-name>.json` (`<server-name>` = the mount pathname
      slugified, e.g. `api-public-mcp` — unique, stable, and the read-back key for per-mount gating
      persistence). "Primary": with exactly one *public* server it is picked silently — the root
      path is probed blind, so the credential-free server is its only sensible owner (not a guess).
      Only the ambiguous cases (several public servers, or none) are asked — in `ax init` and at
      the build review gate (default = first public) — persisted by the root card's `serverUrl`.
      **Known divergence + revisit trigger:** the named sub-path scheme is ax's own (neither the
      current SEP revision nor Ora define one). When **SEP-2127 merges** (watch the PR) or **Ora's
      `mcp-server-card`/`mcp-well-known-discovery` checks change their probed path**, revisit: likely
      additions are `<mount>/server-card` route aliases and a `/.well-known/ai-catalog.json`-shaped
      card listing — note ax's ARD catalog *already* lives at `/.well-known/ai-catalog.json`, so if
      the SEP's AI-Catalog format and the ARD catalog converge, the existing entries may satisfy it
      outright.
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

**Open question #21 resolved from Ora's code (repo access granted):** the emitted `auth` descriptor is
Ora's own `EntryAuth` shape (`eralabs-ai/ora:src/lib/ard/{types,resource-projection,entry-auth}.ts`) —
`status: 'oauth2' | 'api_key' | 'none' | 'unknown'`, optional `oauth` (endpoints + scope keys + `dcr`),
optional `docsUrl` — so a first-party catalog's block survives Ora's crawl-time `sanitizeEntryAuth`
(enum-checked status, http(s)-only URLs, arrays capped 32×256). Ora's derivation
(`authForOpenApi`/`authForMcp`) is mirrored in `src/auth.ts`. Also confirmed in `ora`'s `docs/scoring.md`:
**auth-gating does not lower the score** — advertising a gated surface as *open* (or hiding it) is the
only failure. Emitted verbatim in `src/types.ts` (`EntryAuth`).

- [x] **Detection-first, per-kind — never infer, never guess.** Each artifact carries its own native
      auth-declaration; read the right one per kind:
      - MCP → detect the `withMcpAuth` / `verifyToken` wrapper (`src/detect-mcp.ts`, textual on
        `scrubSource`d content) → mark gated (`auth.status: 'unknown'` — ax can't probe the live
        server for OAuth endpoints at build time); read `withMcpAuth`'s `resourceMetadataPath` literal
        and cross-link it in the server card (`src/server-card.ts` `authentication`). Clerk's official
        MCP path uses exactly `withMcpAuth` + RFC 9728, so this is ecosystem-idiomatic.
      - OpenAPI/REST → read `components.securitySchemes` from the committed doc → the secret-free
        descriptor (`src/auth.ts` `authForOpenApi`): oauth2/openIdConnect → `oauth2` + endpoints/scope
        keys; apiKey/http-bearer/basic → `api_key`; no schemes → `none`. The **secret-guard** is
        `safeHttpUrl` (http(s)-only) + list caps; only structural fields cross, never `description`.
- [x] **Safe default:** a detected/declared gated signal → the artifact is not advertised as open.
      **Never infer "open" from the absence of a signal** — MCP with no wrapper carries no `auth`
      block (never `none`); only a committed OpenAPI doc's own `securitySchemes` can yield `none`.
- [x] **Escape hatch:** optional `isGated?: (target: { kind: 'mcp' | 'openapi' | 'entry'; path: string;
      tools?: string[] }) => boolean` in `ax.config` (`src/gating.ts`). Boolean, whole-artifact for v1.
      A function value, so it's split out before Ajv (which has no function type) and validated with a
      `typeof` check. In `generateCatalog` (`applyGating`): a gated artifact ax can describe is emitted
      *with* its `auth` descriptor; one it can't describe is dropped; an `isGated`-vs-`none` disagreement
      downgrades to `unknown` with a warning. Not built on Clerk's deprecated `createRouteMatcher`.
- [x] **Backstop = review-before-publish (Phase 2.3).** Landed first (see 2.3): the exposure summary
      flags each entry's `auth` status, `--yes` is required in CI, and the disagreement warning is the
      `withMcpAuth`-vs-`isGated` flag. **Phase 2.3 landed alongside this, ahead of Phase 3.5.**
- [x] **Config cleanup:** `isGated` supersedes `denylist`/`allowlist` (a matcher subsumes both; a
      `false` return re-includes, replacing the allowlist). Breaking pre-1.0 change → `src/denylist.ts`
      removed, `config-overrides` fixture + README migrated, `DEFAULT_GATED_GLOBS`/`defaultIsGated`
      replace `DEFAULT_DENYLIST`. No agentic-auth descriptor modeling in v1.

**Done when:** no artifact (catalog entry or server-card) for a detected/declared-gated surface is ever
advertised as open ✓; review-before-publish gates the ambiguous case ✓; and this lands before the canary
✓. (Deploy-only step still open, like the rest of the plan: re-scan a deployed gated fixture through Ora
to confirm the `auth` block is ingested — folded into the Phase 3.5 Vercel step.)

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

- [x] **Agent-aware 404** (`src/agent-404.ts`, `ax.config` `scaffoldAgent404`, default `false`).
      Detect `app/not-found.*`; recommend agent signposts when absent/bare. Opted in: scaffold an
      agent-aware `not-found.tsx` **once** (user-owned, never overwritten) importing a data module
      (`app/not-found-agent-data.*`) **regenerated every build** with the static route list
      (dynamic segments never guessed) and discovery links (catalog / llms.txt / sitemap — only
      artifacts that exist). Grounding: public agent-readability guidance (llms.txt signposting,
      `Link` headers) and Mintlify's benchmark that one llms.txt link on responses eliminates most
      agent 404 dead-ends. Middleware-based content negotiation (markdown 404s for
      `Accept: text/markdown` / `Signature-Agent` requesters) is a documented follow-up — writing
      into a user's singleton `middleware.ts` is too invasive to scaffold today.
      **Update (2026-08-16): the follow-up is now planned as Phase 10** — per the Vercel strategy
      sync, the agreed pattern is a composing higher-order middleware that wraps the user's
      existing middleware instead of owning the file, which removes the invasiveness objection.
      See the Vercel strategy sync section.
- [x] **Machine-readable build report** (`src/report.ts`; `--report[=path]` / `ax.config`
      `report`, default off; default path `.ora/report.json`). The structured twin of the CLI
      output: entries + written paths, MCP mounts + server card, WebMCP sites, per-artifact
      presence, agent-404 status, warnings/recommendations verbatim. Turns the plugin's stdout
      recommendations into something a coding agent consumes directly.
      **Update (2026-07-27): report v2 makes it a handoff, not just a log (`src/ora-checks.ts`).**
      A new `ora` section maps every artifact this build found or generated onto Ora's named
      agent-readiness checks (each `addressed` or `actionable`, with a `note` when a scaffold landed
      but nothing imports it yet), and carries static pointers to Ora's skill (MCP + document URL)
      and scan/score API. A `scaffolds` section records what each opt-in scaffold did this run. The
      mapping (`ORA_CHECK_MAP`) is intentionally conservative — an artifact is listed against a
      check only when the check keys on the artifact's *presence*; content-judgment and
      no-signal checks are absent rather than guessed. The CLI prints a matching handoff footer.
      **No network calls at build time** — every Ora reference is a static string, so the loop
      (read report → work the `actionable` checks → re-scan the deployed site) stays deterministic
      and offline.

---

## The scaffold-and-handoff shift (added 2026-07-27 — reframes the plugin's role)

Three commits on 2026-07-27 (`@ora-ai/ax` rename + WebMCP/404/report, then the config rename +
scaffolds + Ora handoff) moved ax past its original "detect existing artifacts and emit one catalog"
charter into a **generate → detect → scaffold → hand off** tool. None of it loosens *precision over
recall* — the discipline is instead applied to a wider surface. This section is the connective tissue
for the per-phase bullets above (2.2 llms.txt + detector prepass, 2.4 robots, 2.7 JSON-LD, 4.5 report).

**1. Detector precision hardened at the source (`src/scrub-source.ts`).** The textual detectors trade
an AST for cheap, predictable regexes, but a regex can't distinguish a real `createMcpHandler(` /
`.tool('x')` / `document.modelContext.registerTool(...)` call from a *mention* of the same text inside
a `//` comment, a JSDoc block, or an HTML string built with backticks. Those mentions were reaching
the output as **phantom tools and endpoints** — a precision loss, exactly the failure mode the project
exists to prevent. `scrubSource` runs as an offset-preserving prepass that blanks comment bodies (both
delimiter styles) and template-literal *contents* (backticks and `${…}` interpolations kept, so a real
call inside an interpolation is still seen), leaving ordinary `'…'`/`"…"` strings intact because the
detectors legitimately read tool names and JSX `toolname` values out of those (guarded per-line by the
callers' own quote check). Because indices and line numbers survive scrubbing, every downstream match
position is unchanged. Complementary tightening: `registerTool`/`provideContext` now require a
non-empty argument list before they count. It is a lexer-shaped heuristic, not a parser (documented
limits: deeply nested unbalanced template/interpolation and misjudged regex literals can desync until
end-of-line) — an accepted trade for staying AST-free.

**2. From recommend-only to opt-in scaffolding.** ax already *recommended* the missing discovery
artifacts; it now also *writes the mechanical parts* of them, behind explicit opt-in flags. Four
scaffolds share one safety contract — **default `false`** (an unattended build never mutates a
consumer's source tree unasked), **write-once or append-only** (never overwrite, never reorder), and
**derive only what's mechanical, leave judgment to a human/skill**:

  - **`scaffoldLlmsTxt`** — now derives *real* starter content (site name, description, the app's
    static routes, and the artifacts this build generated) instead of a placeholder, so the file is
    useful the moment it lands.
  - **`scaffoldRobots`** (`src/scaffold-robots.ts`) — writes only the two machine-readable pointers ax
    is uniquely placed to know (`Sitemap:` for a sitemap it actually detected, `Agentmap:` for the
    catalog it just generated) plus `Allow` blocks for reputable AI crawlers. An existing
    `public/robots.txt` is *appended to* in a marked, idempotent block; `app/robots.ts` (policy in
    code) is never touched; *blocking* a crawler is only ever shown commented-out. The pending crawler
    user-agent (open question #17) affects only *which* agents to name, not the safe shape.
  - **`scaffoldJsonLd`** (`src/scaffold-json-ld.ts`) — writes an `Organization` component once, with
    the derivable skeleton (name/url/description); `sameAs` (the external profiles that do the actual
    entity disambiguation) is left empty with a TODO because nothing at build time can derive them. ax
    deliberately does **not** wire the component into `app/layout.tsx` (editing the file every page
    renders through, behind the owner's back, is not a postbuild step's call) — it prints the exact
    import + element instead.
  - **`scaffoldAgent404`** (Phase 4.5) — the same pattern: a user-owned `not-found.tsx` written once,
    backed by a data module regenerated every build from the real route tree.

**3. The report became a handoff, not a log (`src/report.ts` v2 + `src/ora-checks.ts`).** The plugin's
half of the loop is deterministic detection/emission/scaffolding; the other half — authoring content,
choosing `sameAs` links, wiring components in — is judgment ax refuses to guess. Report v2 makes that
division *actionable* by a coding agent: `ORA_CHECK_MAP` translates each artifact this build found or
generated into Ora's named agent-readiness checks, each marked `addressed` or `actionable` (with a
`note` when a scaffold landed but nothing imports it yet — e.g. the un-wired JSON-LD component). It
carries static pointers to Ora's `agent-ready-website` skill (both MCP and document URL) and to Ora's
scan/score API, so an agent can close the loop: read the report → work the `actionable` checks →
re-scan the deployed site. The mapping is intentionally conservative (an artifact is listed against a
check only when the check keys on the artifact's *presence*; content-judgment and no-signal checks are
omitted, not guessed), and **every Ora reference is a static string — no network calls at build time**,
keeping the build deterministic and offline. This is the concrete substrate for the Phase 6 companion
skill (it owns exactly the `actionable`/judgment half this report hands off) and directly answers open
question #13's "report per-artifact coverage in the build summary."

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
      **Update (2026-08-16): ship the skill inside the npm tarball** (`files: ["dist", "skill"]`,
      a packaging practice agreed in the Vercel strategy sync) so the package documents its own
      installation to the coding agents that install it. The skill closes the full loop:
      install → `ax init` → build → read `.ora/report.json` → work the `actionable` checks →
      verify via Ora's scan API.
- [ ] Supply-chain: npm provenance on publish, lockfile committed, dependency count reviewed before
      v1 (target: near-zero runtime deps).

**Done when:** v1 success criterion met (Ora + partners indexed) and `latest` published.

---

## Phase 7 — Serving-correctness groundwork (added 2026-08-16)

Goal: the small, independently-shippable primitives Phases 9–10 need, each also useful on its own.
Grounded in the Vercel strategy sync section above — the invariants below are the agreed
engineering behaviors from that alignment; implement them exactly as specified there.

- [x] **`src/markdown-headers.ts` — the two response-header invariants.** One helper (the
      agreed `applyMarkdownHeaders` semantics from the sync) applied to every markdown response ax
      ever serves or scaffolds a server for:
      1. `Vary: Accept`, appended with **token-level dedup** — split the existing `Vary` value on
         commas, trim, compare case-insensitively; never substring-match (a `Vary:
         Accept-Encoding` must not be mistaken for `Accept`). *Why:* without it a CDN caches the
         markdown variant and serves it to browsers, or vice versa — this is the exact failure
         Ora's `markdown-negotiation-vary` check hard-fails on.
      2. `Link: <canonicalUrl>; rel="canonical"` (RFC 8288), added **only when no canonical Link is
         already present** (test the existing `Link` header with `/rel="?canonical"?/i`). *Why:*
         markdown has no `<link rel="canonical">` equivalent; without this header, crawlers index a
         markdown twin as a separate duplicate page and citations attribute to the wrong URL.
      Scope note: `llms.txt` keeps `Content-Type: text/plain` and needs neither header (it is a
      fixed-path artifact, not a negotiated variant of another page) — the helper is for twins,
      the agent-404 markdown body, and any negotiated response (Phases 9–10).
      (Shipped `src/markdown-headers.ts` + `test/markdown-headers.test.ts`; Web-API-only, exported
      from `index.ts`. Vary uses comma-split token dedup + `*` handling; canonical Link tested
      `/rel="?canonical"?/i`. Cites RFC 8288 / RFC 9110 §12.5.5, no `#` phase references in source.)
- [x] **`src/agent-ua.ts` — the agent/bot detection corpus, single source of truth.** Implement
      the four data sets specified in the sync section (`AI_AGENT_UA_PATTERNS`,
      `SIGNATURE_AGENT_DOMAINS`, `TRADITIONAL_BOT_PATTERNS`, `BOT_LIKE_REGEX`), citing the
      underlying sources (bots.fyi + vendor bot docs) and carrying a review date so staleness is
      visible. Consumers: (a) `scaffold-robots.ts` — today it names only 5
      allow-crawlers; regroup from the corpus so the generated `Allow` block covers the retrieval/
      search families we currently miss (OAI-SearchBot, Claude-SearchBot, Meta-ExternalAgent /
      Meta-ExternalFetcher, Amazonbot, AI2Bot, Diffbot, …) while **keeping the existing policy
      split**: reputable retrieval crawlers get `Allow`; training-only crawlers (CCBot, Bytespider)
      stay a commented-out example — blocking is the owner's call, never ours. (b) The Phase 10
      middleware's detection layer. (c) Future docs/recommendation copy, so crawler names never
      drift between features.
      (Shipped `src/agent-ua.ts` + `test/agent-ua.test.ts` with `UA_CORPUS_REVIEWED` = 2026-03-20
      and the four data sets, plus `REPUTABLE_AI_CRAWLERS` / `TRAINING_ONLY_CRAWLERS` as the robots
      policy split — exported so casing (canonical robots tokens) and match form (lowercase UA
      substrings) each live in one place. `scaffold-robots.ts` now consumes them; its Allow block
      grew from 5 crawlers to the OpenAI/Anthropic/Google/Perplexity/Meta/Amazon/AI2/Diffbot
      retrieval+search families. scaffold-robots tests + the README copy updated deliberately.
      Deviation: the corpus is not yet consumed by a detection module — that is Phase 10; this only
      lands the data + the robots consumer.)
- [x] **Born-passing tests: the agreed audit criteria become our scaffold acceptance criteria.**
      Add a test suite asserting every generated artifact passes the relevant audit criterion from
      the sync *by construction* (the audits are black-box HTTP probes, so the assertions run on
      the generated file contents): scaffolded `llms.txt` has an H1, ≥1 markdown link, is ≤100,000
      chars, and has an **even count of column-0 code-fence markers** (`/^(`{3,}|~{3,})/gm` — an odd
      count means an unclosed fence, which corrupts everything below it in an agent's context);
      generated `robots.txt`, run through a real user-agent block parser, never leaves
      gptbot / claudebot / ccbot / google-extended covered by a `Disallow: /`; generated markdown
      (Phase 9 twins, `/auth.md`) carries the agreed frontmatter keys (see Phase 9).
      *Why:* "ax ran" should imply "the mechanical half of any agent-readiness audit is green" —
      that's the product promise, and these tests make it a regression-tested invariant instead of
      a hope.
      (Shipped `test/born-passing.test.ts`: the scaffolded llms.txt (both the static Pages-Router
      output and the App-Router route body) is asserted to have an H1, ≥1 link, ≤100,000 chars, and
      an even column-0 fence count; the generated robots.txt is run through a hand-written
      user-agent-block parser — groups User-agent lines with the rules that follow, most-specific
      match wins, comments ignored — and gptbot/claudebot/ccbot/google-extended are confirmed not
      Disallowed, with a negative control proving the parser catches a real block. Deviation: the
      markdown-twin / `/auth.md` frontmatter assertion is deferred with Phase 9, since no markdown
      twins are generated yet — added the moment Phase 9 emits them.)
- [x] **Token-aware sizes in the CLI summary and `.ora/report.json`.** Report every generated
      artifact's size as KB **and** estimated tokens (chars ÷ 4 — the same estimate Ora uses), and
      warn above 100,000 chars (≈25k tokens): "Claude Code truncates responses over 100K chars."
      *Why:* tokens are the unit that actually constrains the consuming agent; the numbers are free
      to compute at write time.
      (Shipped `src/artifact-size.ts` (`chars ÷ 4` token estimate, KB/B, 100K-char truncation gate)
      + `test/artifact-size.test.ts`; the CLI measures each written artifact — catalog, server card,
      and any scaffold that produced a file this run — off disk, prints a sizes block, and warns per
      over-limit artifact. `.ora/report.json` gained a `sizes[]` section. Deviation: the report no
      longer carries a `reportVersion` field at all — versioning starts at first publish (add
      `reportVersion: 1` then), so the field was removed rather than bumped. README updated.)
- [x] **Two recommendation-copy refinements** (advisory channel, no new detection): the sitemap
      recommendation mentions including `<lastmod>` (agents use it to judge freshness — Ora's own
      recommendation copy already says this); and when markdown twins exist (Phase 9), recommend an
      HTML `<link rel="alternate" type="text/markdown" href="…">` in the root layout — printed with
      the exact tag, like the JSON-LD wiring instructions, never auto-inserted.
      (Shipped: `detect-sitemap.ts` recommendations (both present + absent) now mention `<lastmod>`,
      asserted in `test/detect-sitemap.test.ts`. The markdown-alternate copy lives in
      `src/markdown-alternate.ts` gated on a `twinPaths` presence check — empty today, so it adds
      nothing to a current build and stays invisible until Phase 9 supplies the twin manifest;
      `test/markdown-alternate.test.ts` drives it with a synthetic twin list. Wired into
      `generate.ts` with `twinPaths: []`.)

**Done when:** the header helper + corpus module exist with tests; scaffold outputs are covered by
born-passing assertions in CI; sizes print in tokens; both recommendation texts ship.
✓ All shipped and green (typecheck / test / lint / fixtures:build). Note for Phases 9–10: Phase 9
must (a) populate `buildMarkdownAlternateRecommendation`'s `twinPaths` from its serving manifest to
switch that recommendation on, and (b) extend `test/born-passing.test.ts` with the twin/`auth.md`
frontmatter assertions. Phase 10's detection layer consumes `src/agent-ua.ts` and its middleware
markdown responses call `applyMarkdownHeaders` from `src/markdown-headers.ts`.

---

## Phase 8 — `ax init`: the onboarding wizard (added 2026-08-16)

Goal: collapse "read the config docs, hand-write `ax.config.ts`, wire `postbuild`" into one
interactive command. The wizard's principle: **it captures judgment; the build derives facts.** It
asks only questions whose answers are genuinely underivable from the source tree, writes them into
`ax.config.ts`, wires the scripts — and generates **no public-facing artifact itself**, so the
first real build remains the moment the review-before-publish gate (Phase 2.3) runs, now
pre-answered by the wizard's choices. The two features compose; there is no second consent
ceremony.

**Hard constraints (each has a reason):**

- **An explicit command, never a `postinstall` hook.** npm lifecycle hooks can't reliably prompt
  (no TTY under CI/pnpm/silent installs) and interactive postinstall is a supply-chain smell.
  Install stays inert; README + companion skill say `npx ax init`.
- **Detect first, ask second.** Run the existing detection pass (router model, MCP/OpenAPI/llms.txt/
  robots/sitemap/JSON-LD detectors — all source-tree-based, **no `next build` required**) before
  any question, then show a findings summary. Questions are then *informed* ("I found these
  surfaces — which are gated?") instead of blank forms.
- **Never ask what the source tree answers.** Language (TS vs JS) comes from `tsconfig.json`
  presence — the config file extension and scaffold extensions follow it. Routers, routes, and
  existing artifacts come from detection. Every derivable question the wizard asks erodes trust in
  the detection story that is ax's identity.
- **Never overwrite.** If any `ax.config.*` exists, abort with a message pointing at the file
  (v1; a targeted "add missing keys" mode can come later). Same write-once posture as scaffolds.

**The flow (implementation order):**

1. `ax init` subcommand in `cli.ts` (bare `ax` behavior unchanged; when bare `ax` runs with no
   config in an interactive TTY, it may *suggest* `ax init` in its output).
2. Detection pass → findings summary (routers found, N static routes, detected surfaces, existing
   artifacts).
3. Questions, each with a default and the reason it must be asked:
   - **`siteUrl`** — the production origin. Underivable locally (`VERCEL_PROJECT_PRODUCTION_URL`
     exists only on Vercel builds). Validate: absolute `https://` origin; **refuse `localhost`/
     preview URLs** with the explanation that the value is written verbatim into public catalog
     URLs.
   - **Gated surfaces** — multi-select over the *detected* MCP mounts / OpenAPI paths / declared
     entries, with the default floor (`/api/auth/**`, `/api/webhooks/**`) pre-noted. Answers
     become an `isGated` matcher (compose `defaultIsGated` unless the user deselects the floor).
     A reviewed detection beats free-text glob authoring.
   - **Scaffold opt-ins** (`scaffoldLlmsTxt`, `scaffoldJsonLd`, `scaffoldRobots`,
     `scaffoldAgent404`) — **default yes in the wizard.** This is not a contradiction of the
     config's `false` defaults: config defaults are `false` because *silent* writes into a source
     tree are invasive; in a wizard the user is present and the ask itself is the opt-in.
     Default-yes-when-asked / default-no-when-silent is one coherent policy — state it in the docs.
   - **Markdown twins** (once Phase 9 ships) — records intent into config; generation still
     happens at build (twins need rendered output — see Phase 9's tier ladder).
   - **`report`** — default yes (the agent-handoff loop is the product).
4. Write `ax.config.ts` (or `.js`, per detected language) with the answers **and a one-line
   comment per field saying why it's there** — the generated config doubles as documentation.
5. Wire scripts in `package.json`: add `"postbuild": "ax"` **only when no `postbuild` exists**;
   if one exists, print the exact edit instead of chaining into a script we don't own (same rule
   as never editing `layout.tsx`). This wiring is the actual friction-killer — `postbuild` runs
   wherever `build` runs (Vercel, CI), so builders who never build locally still get every
   artifact on deploy.
6. Offer to run the first build + ax pass now, so the user sees the report immediately.
7. Non-interactive mode: `ax init --yes --site-url <url>` applies all defaults (siteUrl has no
   default and must be supplied via flag or env); exits non-zero with a clear message when
   required inputs are missing.

**Tests:** the prompt layer is injected (an interface over `node:readline`), so the wizard is unit
tested with scripted answers; a fixture round-trip asserts init → generated config validates via
the existing `AxConfig` schema → subsequent `ax` build succeeds and the review gate sees the
wizard's choices.

**Done when:** `npx ax init` on the `bare` fixture produces a valid `ax.config.ts` + wired
`postbuild` from scripted answers, refuses to touch an existing config, and `--yes` works headless.

**✓ shipped (2026-08-16).** `ax init` implemented as `src/init.ts` (wizard flow), `src/prompt.ts`
(the injected `Prompter` interface over `node:readline`, so the whole flow is unit-tested with
scripted answers and no TTY), `src/init-config.ts` (pure answers→`ax.config` source renderer, one
rationale comment per field), and `src/init-package-json.ts` (pure `postbuild` wiring decision).
`cli.ts` routes the `init` subcommand (bare `ax` unchanged; an unknown subcommand still errors), and
a bare interactive `ax` run with no config now prints a one-line `ax init` tip. Detection reuses
`generateCatalog` verbatim — the same pass a build runs — so the findings can't drift; it writes no
public artifact, so the review-before-publish gate remains the first-build consent ceremony,
pre-answered by the wizard. Config language follows `tsconfig.json` presence and `.js` module system
follows `package.json` `type`; `isGated` composes `defaultIsGated` (or is omitted when only the floor
is kept, since an absent `isGated` already means "floor applies"), and is only written as real code
loaded through the existing jiti path — no parallel config writer/validator. Colocated tests:
`init-config.test.ts`, `init-package-json.test.ts`, and `init.test.ts` (scripted-answer flow, the
never-overwrite refusal, headless `--yes`, `siteUrl` validation refusing localhost/preview, and a
fixture round-trip that init→loads+validates via `loadAxConfig`→builds via `runCli` and confirms the
review gate sees the wizard's `siteUrl`). No new dependencies.

**Deviations from the plan, each with its reason:**

- **Round-trip runs against a synthesized bare app, not the committed `fixtures/bare/`.** Mutating a
  committed fixture from a test (writing `ax.config.ts` + editing its `package.json`) would leave the
  working tree dirty and race parallel fixture use, so the test builds a byte-identical minimal
  TS Next app in a temp dir. Same assertion surface as "on the `bare` fixture".
- **The first-build offer (step 6) is default-**no** and skipped entirely in `--yes`/headless mode**,
  and its build runner is injected (`InitIO.spawnBuild`). Spawning a full `next build` unasked is
  heavy and a headless run should stay side-effect-light; the injection keeps tests from spawning.
- **Markdown-twin intent (step 3's Phase 9 bullet) is intentionally omitted, not stubbed.** Per the
  scope note, twins are out of scope until Phase 9; the wizard invents no config surface it can't yet
  honour. See the Phase 9 hand-off note below for where it should slot in.

**For Phase 9/10:** the wizard is where markdown-twin *intent* should be captured once twins exist —
add a scaffold-style question and render a new `ax.config` field in `src/init-config.ts`'s
`renderAxConfig` (its field list is the single place to extend, with the same yes-when-asked policy).
(Stale note, corrected 2026-08-19: the wizard no longer writes `isGated` — since PR #20, MCP server
gating is per-server and persisted in the committed server card, read back via
`src/server-card-record.ts` / `resolveMcpMountGating`. For page/route paths — the surface Tier-2's
"never derive a twin from a gated route" guard needs — use `resolveGating(config.isGated)` from
`src/gating.ts`, which applies the built-in `/api/auth/**` + `/api/webhooks/**` floor unless the
user supplied their own matcher. Still no new gating surface needed.)

**Amendment (2026-08-23):** the seven setup questions (`scaffoldLlmsTxt`, `scaffoldJsonLd`,
`scaffoldRobots`, `scaffoldAgent404`, `markdownTwins`, `report`, `wireManifest`) collapsed from
sequential y/n confirms into one multi-select checklist (`SETUP_OPTIONS` in `src/init.ts`), every
item pre-selected with a one-line "why" in its label (e.g. "Scaffold llms.txt — a guided map so
agents know how to navigate your site"). Same yes-when-asked/no-when-silent policy as before — the
list itself is now the single ask, deselecting an item is the opt-out — just collapsed from seven
prompts into one, since none of the seven choices depends on another's answer.

---

## Phase 9 — Markdown twins & generated markdown artifacts (added 2026-08-16)

Goal: the **retrieval half** of agent-readiness — per-page markdown representations of real
content — which no tool generates today: the ecosystem's middleware approach routes agents to
markdown the developer was supposed to write; ax writes it from the build, and is honest about
which pages it can't (a division of labor confirmed in the Vercel strategy sync). Twins are
**generated artifacts, not scaffolds**: regenerated every build, never user-owned
(the scaffold contract is write-once/user-edited, which for twins would mean drift — a stale twin
silently lies about the page it shadows, and an agent cites it as current truth). The moment a
human wants to edit a twin, the page belongs in Tier 1 (a real markdown source in the repo), not
in a fork of generated output.

### 9.1 The tier ladder — where twin content comes from

The whole design is one question — *where does the markdown come from?* — answered as a ladder of
decreasing certainty, so precision-over-recall maps onto it directly:

- [x] **Tier 1 — reference/derive from markdown-shaped sources (no build output needed).** Detect
      routes whose content already lives as markdown in the repo: `app/**/page.mdx`, existing
      markdown route handlers, stray `public/*.md`. Map route → source. For MDX, emit the twin
      only when the file is *mostly markdown* (guard: fraction of lines that are imports/exports/
      JSX blocks below a threshold — strip those, keep the markdown); otherwise recommend instead
      of guessing. Highest fidelity — the markdown is the source, not a reconstruction — and it
      covers the docs-site audience with zero conversion machinery.
- [x] **Tier 2 — derive from the build output for prerendered routes.** After `next build`, every
      statically prerendered route's final HTML exists in the build output (App Router:
      `.next/server/app/**.html` — **verify the location per supported Next minor and cover it in
      the Phase 5.2 canary job; this is a semi-stable internal**). Pipeline per route: locate the
      HTML → extract the content region (`<main>`, else `<article>`, else skip — extracting
      `<body>` would drag nav/footer chrome into the twin) → convert HTML→markdown → apply guards
      → write. **Guards (each one is a refusal to publish a lie):** skip when extracted text
      < 200 chars (a twin of a JS-shell page is an empty lie — 200 chars is also where the agreed
      server-rendered-content audit criterion draws the line); skip when > 100,000 chars
      (truncation ceiling); **never derive from
      a route `isGated` matches** (a gated page's prerender is typically a login shell — the twin
      would be a beautifully-converted login page, the exact artifact auth-gate audits exist to
      catch); assert an even code-fence count post-conversion. Every skip is recorded in the
      report **with its reason** — the skip list is itself the "what to do next" guidance.
- [x] **Tier 3 — dynamic/SSR routes: refuse.** No build-time HTML exists, so no twin, no guessing
      (same policy as dynamic segments in llms.txt and the agent-404). The manifest records "no
      markdown target"; the CLI recommends what the developer could do (add a markdown source, or
      prerender the route).

### 9.2 Twin output & metadata

- [x] Twins are written as **static files in `public/`**: route `/docs/getting-started` →
      `public/docs/getting-started.md`; the root route → `public/index.md` (which also satisfies
      Ora's `markdown-url-fallback` homepage probe). *Why static files:* the `.md`-URL twin then
      works with **zero runtime** — Next serves `public/` as-is — so one of the three retrieval
      mechanisms (`.md` URL / Accept header / agent UA) passes before any middleware ships, and
      the middleware (Phase 10) becomes an upgrade, not a requirement. Same emission path and
      deploy-verification story as the catalog.
- [x] Every twin opens with **YAML frontmatter** carrying the four keys the agreed audit criteria
      check for, all derivable at build time: `title` (page `<title>`/first H1), `description`
      (meta description when present), `canonical_url` (siteUrl + route — the attribution link
      back to the HTML page), `last_updated` (build time — truthful: twins are exactly as fresh as
      the build). Plus a `generated-by: @ora-ai/ax` marker so humans and tools know not to
      hand-edit.
- [x] Twins never become catalog entries (the per-route-entry prohibition stands — nobody indexes
      per-page entries); they surface via the scaffolded `llms.txt` (Machine-readable resources
      section), the `<link rel="alternate" type="text/markdown">` recommendation (Phase 7), and
      the manifest (9.4).
- [x] **Review gate extension:** twins change the site's public surface, so the first run that
      would write them extends the Phase 2.3 "about to expose" summary with the twin count + sample
      paths, behind the same `--yes` / interactive confirm.

### 9.3 The gated-surface serving policy + generated `/auth.md`

What should a gated route serve an agent? **Not** a 200 "this is gated" page — that's a soft auth
wall, status-code lying of exactly the kind agents are built to distrust (the 200-wayfinding move
is legitimate only for 404s, which have no honest next step; a 401 has one). The policy, split by
who can implement it:

- [x] **Generated `/auth.md` (build-side, this phase):** one markdown document derived from the
      auth detection Phase 2.8 already does — the gated surfaces (paths + kind), the auth scheme
      per surface (from the `EntryAuth` descriptors: oauth2 endpoints / api_key / unknown), the
      `resourceMetadataPath` cross-link when `withMcpAuth` declared one, and where a human obtains
      credentials (`docsUrl` when known, TODO otherwise). Regenerated every build; written to
      `public/auth.md` with the same frontmatter as twins; linked from the scaffolded `llms.txt`.
      *Why one doc instead of N gated twins:* it aggregates what agents actually need (how do I
      get access?), it's fully derivable, and Ora's agent-simulation checks already look for
      auth-docs artifacts. One honest, derivable artifact doing the job N invented ones would.
- [x] **Recommendation (advisory, this phase):** for detected gated routes, recommend keeping the
      honest 401/403 status and adding a `WWW-Authenticate` header + a body/`Link` pointer to
      `/auth.md` — the gated cousin of the agent-404. Route-handler *behavior* is the developer's
      code, so this stays a recommendation (with the report carrying it), never a rewrite.

### 9.4 The serving manifest (the piece Phase 10 consumes)

- [x] Generate a **manifest data module** (pattern proven by `app/not-found-agent-data.*`):
      regenerated every run, importable by user middleware, containing — the route table
      (static routes only), which routes have markdown twins (and the twin path), which paths are
      gated (from `isGated` results), and where the discovery artifacts actually live
      (basePath-aware). This is what makes our middleware **never rewrite blind** — the specific
      middleware weakness the strategy sync identified (a Next.js middleware alone cannot check a
      rewrite target exists).
- [x] **Build-ordering wrinkle (design decision needed at implementation time):** `middleware.ts`
      is compiled *during* `next build`, but ax runs *post*build — so a manifest generated
      postbuild is consumed by the *next* build (one-build staleness). The manifest is derived
      from the **source tree** (router model + config), not from build output, so the fix is
      cheap: expose a fast `ax manifest` subcommand and let `ax init` wire it as `prebuild`.
      Twin *files* (build-output-derived, Tier 2) stay postbuild — they're served from `public/`,
      not compiled into the middleware, so ordering doesn't bite them. Document whichever shape
      ships; the constraint (middleware bundles at build time, `public/` doesn't) is the invariant
      to design around.

### 9.5 Open decisions (record resolutions here)

- **Twins default-on vs opt-in.** Leaning **default-on behind the existing first-publish review
  gate** (the confirmation makes default-on safe, and it's the stronger product statement — the
  wizard asks anyway); but every scaffold precedent is opt-in. Product call, deliberately not
  derivable. **Resolved 2026-08-19: default-on behind the review gate.** Twins are generated
  artifacts, not scaffolds, so the scaffold opt-in precedent doesn't bind them; the review gate is
  the consent ceremony. Config gets a `markdownTwins` switch (default `true`) so opting *out* is
  one line.
- **HTML→markdown converter dependency** (Tier 2 only; Tier 1 needs none). A turndown-class
  library would be the first non-trivial CLI dependency beyond ajv/jiti. Options: smallest
  maintained converter vs. a minimal internal one (headings/paragraphs/lists/links/code — refuse
  exotic HTML rather than mis-convert it, consistent with the tier ladder). Tier 1 + manifest can
  ship first and defer this. **Resolved 2026-08-19: take the dependency — `turndown` (+ GFM
  plugin for tables), CLI-side only, never in the runtime/middleware import graph.** Checked
  `@vercel/agent-readability` first: it ships no converter at all (negotiation only), confirming
  there is nothing lighter to borrow and that generating the markdown is exactly ax's
  differentiation.
- **Tier-1 MDX "mostly markdown" threshold.** Pick empirically against fixtures.
  **Resolved 2026-08-19: start at ≤25% non-markdown lines** (imports/exports/JSX-block lines over
  non-blank lines), tuned against the `mdx-content` fixture; component-heavy pages get a
  recommendation instead of a twin.
- **9.4 manifest ordering (resolved 2026-08-19): `ax manifest` prebuild subcommand.** The manifest
  is source-tree+config-derived, so a fast `ax manifest` subcommand regenerates it before
  `next build` compiles middleware; `ax init` wires it as `prebuild` (same never-overwrite rules
  as the `postbuild` wiring). The full postbuild run also refreshes it, so unwired projects
  converge with one-build staleness.

**Fixtures:** an `mdx-content` fixture (Tier 1), a prerendered-pages fixture with `<main>`
(Tier 2 happy path), a JS-shell page (Tier 2 skip: too little text), a gated route (Tier 2 skip:
gated), a dynamic route (Tier 3). Snapshot the twins like catalogs; every twin snapshot must pass
the Phase 7 born-passing assertions.

**Done when:** Tier 1 + manifest + `/auth.md` ship with the review-gate extension and fixtures;
Tier 2 ships behind the converter decision; every generated twin passes the born-passing suite;
the report's skip list names a reason for every twin-less route.

**✓ shipped (2026-08-19).** All three tiers plus `/auth.md`, the serving manifest, and `ax
manifest` in one PR (the converter decision resolved same-day, so Tier 2 didn't need to trail).
Modules: `src/markdown-artifact.ts` (frontmatter + generated-by marker + fence counting, the
shared generated-markdown contract), `src/mdx-twin.ts` (Tier 1 line-based stripping, ≤25% guard),
`src/html-twin.ts` (Tier 2: domino parse → `<main>`/`<article>` region → turndown+GFM, all four
refusals), `src/markdown-twins.ts` (the ladder orchestrator: user-owned detection via the marker,
stale-twin sweep, dynamic-route tally; plans are pure, applied by the CLI only after the review
gate), `src/auth-md.ts`, `src/manifest.ts` (+ `ax manifest` in cli.ts, `prebuild` wiring +
`markdownTwins` question in the wizard). Report gained a `markdownTwins` section (written /
user-owned / skipped-with-reason / deleted / authMd); llms.txt starter links twins + the auth
guide; `buildMarkdownAlternateRecommendation` now receives real twin paths. Fixtures
`markdown-twins` (all Tier-2 paths + user-owned + gated + dynamic) and `mdx-content` (@next/mdx,
both threshold outcomes); twin snapshots live in `fixtures/*/twins.golden/` (normalized
`last_updated`, written/verified by the report-snapshot script) and the born-passing suite asserts
the frontmatter/fence contract on both synthetic output and every committed snapshot.

Deviations, each with its reason:
- **Tier-2 HTML is located by walking `<distDir>/server/{app,pages}` for `.html`** (route groups
  dropped, `index` collapsing) rather than parsing `app-path-routes-manifest.json` — the walk
  covers both routers with one code path and degrades to "nothing prerendered" when the semi-stable
  layout shifts; the Phase 5.2 canary still owns version drift.
- **A gated route's twin skip is decided by `resolveGating(config.isGated)` with a new `'page'`
  GateTarget kind** — the Phase 8 note claiming the wizard's written `isGated` would be the
  matcher was stale (see the correction there); the wizard writes no isGated since PR #20.
- **Turning `markdownTwins` off does not delete previously generated files** — deleting public/
  content on a config flip is not a decision to make silently; the stale sweep only runs while the
  feature is on.
- **The manifest module is refresh-if-present on full runs** (created only by `ax manifest` / the
  wizard's opt-in wiring), so a plain build never introduces a new source-tree file silently.

Amendment (2026-08-23, from demo manual testing): a **metadata rung** was added between Tiers 2
and 3 — a content-less (client-rendered) page whose `page.tsx` declares its *own* metadata gets a
minimal twin from the rendered head (title/description + an explicit "content renders in the
browser" note), labeled `source: 'metadata'` in the report. Ownership is read from the page source
(the rendered head can't distinguish page metadata from the layout cascade) and values from the
render; heads shared across routes are refused as inherited-in-practice. Skip guidance was also
reworded: wrap {children} in <main> at the layout (never per-page placeholder pre-hydration DOM,
which paints and flickers), and declare per-page metadata for client-rendered pages.

---

## Phase 10 — Runtime: `@ora-ai/ax/middleware` (added 2026-08-16)

Goal: the **negotiation half** — detected agents (and `Accept: text/markdown` requesters) receive
the markdown ax generated, with correct headers, without the developer writing any serving logic.
This is the follow-up Phase 4.5 deferred, now unblocked (see the Vercel strategy sync section).
Design brief: implement the engineering invariants agreed in the sync (detection cascade, header
invariants, HOF composition, armored callbacks), and close the one structural weakness the sync
identified in middleware-only approaches (blind rewriting) with the Phase 9 manifest.

**Posture note (document in the module):** detection here is deliberately *recall over precision*
— mis-serving markdown to a misidentified client is low-harm and reversible. This does not loosen
the emission-side precision posture; the stakes differ by layer. Both cloaking guards are
**non-optional**: traditional search crawlers (Googlebot et al.) must never be rerouted (cloaking
risk), and browser document navigations must never match on UA substrings (Cursor's embedded
browser contains "cursor" in its UA and must get HTML).

### 10.1 Packaging

- [ ] New export `"./middleware"` in `packages/ax/package.json` `exports`, built as its own tsup
      entry. **Zero dependencies, Web-API only** (Edge-safe) — ajv/jiti must not enter this
      entry's import graph (the CLI keeps them; the runtime entry is the only code a consumer's
      app imports at runtime). `next` becomes an **optional peer dependency** (types only),
      `sideEffects: false` stays.

### 10.2 Detection (`src/middleware/detection.ts`)

- [ ] Implement the 3-layer cascade exactly as specified in the sync section, consuming the
      Phase 7 corpus: (1) UA-substring match, suppressed on real browser document navigations;
      (2) `Signature-Agent` header contains a known domain; (3) heuristic — `sec-fetch-mode`
      absent + `BOT_LIKE_REGEX` UA + not in `TRADITIONAL_BOT_PATTERNS`. Return a discriminated
      result (`{ detected, method }`) so `onDetection` can log the method. Cover the agreed edge
      cases (embedded-browser UA like Cursor's must stay HTML; Googlebot never rerouted;
      Signature-Agent positive) as table tests.

### 10.3 Behavior (`src/middleware/index.ts`)

- [ ] A composing HOF (working name `withAx(options, existingMiddleware?)` — final name open),
      taking the **generated manifest** (imported module, Phase 9.4) plus `onDetection?` and
      `canonicalUrl?` overrides. Per request, in order:
      1. Not an agent and no markdown `Accept` → fall through to the wrapped middleware /
         `NextResponse.next()`. (Also export a recommended `matcher` with the agreed exclusion
         list: `_next`, `api`, static files, favicon/robots/health/status.)
      2. Agent/Accept + **manifest says the path has a twin** → `NextResponse.rewrite()` to the
         twin path + apply `markdown-headers` (Vary + canonical Link pointing at the HTML URL).
         Never rewrite a path the manifest doesn't list — no blind rewrites, ever.
      3. Agent/Accept + **manifest says the path is gated** → fall through untouched. The app's
         own 401/403 answers; middleware never fakes or masks auth (the 9.3 recommendation covers
         the 401 body). 
      4. Agent/Accept + **path matches no route in the manifest** → respond **200 +
         `text/markdown`** with a wayfinding body rendered from the manifest (real routes + only
         the discovery artifacts that exist) — the runtime completion of the Phase 4.5 agent-404,
         and the "agents discard 404 bodies" doctrine applied with real build-derived data instead
         of a generic template. Plain clients keep the honest 404 via the normal app path.
- [ ] **Armored `onDetection`:** sync throws swallowed; promises to `event.waitUntil()`.
      Telemetry must never break serving.
- [ ] **Canonical-URL hardening:** when deriving the canonical from request headers (proxy
      setups), round-trip `Host`/`X-Forwarded-Proto` through the URL parser and rebuild from
      parsed components; unparseable → omit the Link header rather than reflect raw input
      (header-injection guard — hostile `Host` values must never corrupt a response header).

### 10.4 Wiring (same rules as every scaffold)

- [ ] Never edit an existing `middleware.ts`. The CLI prints the exact 3-line wiring (import,
      wrap, matcher) phrased for a coding agent, and `.ora/report.json` carries the same strings —
      identical to the JSON-LD wiring pattern.
- [ ] Optionally scaffold `middleware.ts` **only when none exists** (write-once, behind an opt-in
      flag / the wizard question).

### 10.5 Verification

- [ ] Unit: detection table tests; manifest gating (gated path never rewritten; unlisted path
      never rewritten); header invariants (Vary deduped against pre-existing values; canonical
      Link not duplicated); 404-negotiation body renders from a manifest fixture.
- [ ] **Dogfood target:** a fixture app running `next start` must pass Ora's
      `markdown-negotiation-vary` semantics — dual-fetch of the same URL (with and without
      `Accept: text/markdown`) returns different content-types, correct bodies both ways, and
      `Vary: Accept` on the negotiated response. This is the strictest known external check; the
      header helper should make failing it impossible. Live-deploy confirmation folds into the
      existing Vercel deploy steps.

**Done when:** the fixture passes the dual-fetch dogfood test locally; no rewrite ever fires for a
gated or unlisted path (asserted); the wiring instructions appear in CLI output + report; the
runtime entry's bundle contains no CLI dependencies.

---

## Open product questions for Ora (resolve in Phase 0.1)

| # | Question | Recommendation | Decision |
|---|----------|----------------|----------|
| 1 | Pages Router in v1? | ~~No — App Router only~~ **Yes** — App Router and Pages Router (and both at once), via a single `RouterModel` port. | **resolved** |
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
| 14 | Which entry fields should a first-party catalog self-declare? (`auth`, `capabilities`, `representativeQueries`, `provenance`, `trustManifest.attestations`) | **Partly resolved by the spec (2026-07-19):** `capabilities` / `representativeQueries` / `trustManifest` are first-class ARD fields, not Ora extensions — `representativeQueries` (2–5 items) drives registry search embeddings, so it's plainly worth self-declaring; supported via `ax.config` `entries`. `capabilities` emitted zero-config for MCP. Only `auth` / entry-level `provenance` are true extensions — confirm with Ora how they weigh those. | _mostly resolved_ |
| 15 | Agent **skills** (`application/ai-skill+md`): does Ora expect skills in a published GitHub repo, and should the plugin help scaffold/reference one? | Detect-and-reference a skills repo if present; do not invent skills. Scaffolding = later. | _pending_ |
| 16 | Once the skill's `api-catalog`→`ai-catalog` bug is fixed, do the **registry crawler and the score scanner** both key on ARD `/.well-known/ai-catalog.json`? | Confirm they agree — the plugin's headline output depends on it | _pending (Ora aware of the skill bug 2026-07-22, fix expected)_ |
| 17 | What `User-agent` token does **Ora's crawler** send? | Needed to detect a blocking robots.txt and to author the scoped `Allow` recommendation | _pending_ |
| 18 | Does the plugin/companion skill scope include `agents.md` content and the robots.txt policy, or does Ora expect those from its own `agent-ready-website` skill? | Plugin detects/scaffolds structure; companion skill authors content and defers to Ora's skill for the scan loop | _pending_ |
| 19 | Confirm the **MCP server-card path/schema** Ora's `mcp-server-card` check expects: SEP-1649/PR-2127 `/.well-known/mcp/server-card.json` (media type `application/mcp-server-card+json`)? The contact cited `agentic-community/mcp-gateway-registry#119`, but that issue is a *different* vendor's multi-server `/.well-known/mcp-servers` registry format — likely a miscitation. Also: should we emit the `/.well-known/mcp.json` alias (SEP-1649's original name)? | Build the SEP-1649/2127 server card (matches the path Ora already probes); alias `mcp.json` if it helps clients | **Empirically pinned (2026-07-22, tunnel scans of a deployed `mcp-handler` server):** `mcp-server-card` **passes** on the plugin's generated card at `/.well-known/mcp/server-card.json` (found + accepted). But **`mcp-well-known-discovery` never extracts the server URL and all runtime `mcp-*` checks stay `na` ("No MCP server detected")** — unchanged across `serverUrl`/`remotes`/`transport.endpoint` field shapes, with a `/.well-known/mcp.json` alias also present, and with a live endpoint that answers `initialize`. So Ora's MCP *discovery* is **decoupled** from the server-card and uses an undocumented mechanism. Caveat: tested on a `*.trycloudflare.com` tunnel (the `mcp-server: pass` was a Cloudflare brand false-positive), so discovery may not run truthfully off a real domain — **re-test on the Vercel deploy.** Open for Ora: how does `mcp-well-known-discovery` find the URL, and does it connect on non-registered domains? |
| 20 | Should Ora's **MCP discovery consume the ARD catalog's `application/mcp-server-card+json` entry**? Empirically (2026-07-22 scan) Ora validates the catalog (`ard-catalog: pass`) but ignores it for MCP discovery — it only reads `/.well-known/mcp/server-card.json`, so a real MCP server scored **0**. If discovery consumed the catalog entry, the plugin's existing output would already work. | Ideally yes — otherwise the plugin must emit the well-known card too (Phase 2.7) | _pending_ |
| 21 | Which **auth shape** does Ora reward, and where does it read it — OpenAPI `securitySchemes`, the server-card `authentication` block, or RFC 9728 `/.well-known/oauth-protected-resource`? Drives Phase 2.8. | Read the native per-kind declaration (securitySchemes for REST, `withMcpAuth`+RFC 9728 for MCP); confirm Ora's weighting | _pending_ |
| 22 | Markdown twins (Phase 9): **default-on behind the review gate, or opt-in** like every scaffold? Twins are generated (not user-owned) and the first-publish y/N gate makes default-on safe, but all scaffold precedent is opt-in. | Default-on behind the existing review gate — the stronger product statement; the `ax init` wizard asks explicitly either way | _pending — product call_ |
| 23 | How does Ora **weight per-page markdown retrieval** — `.md` URL twins per content page, agent-UA → markdown, Accept-header negotiation, per-response frontmatter? Determines how much of Phase 9 Tier 2 / Phase 10 to prioritize vs. Tier 1 alone. (Known today: `markdown-negotiation`/`markdown-negotiation-vary` score Accept-based negotiation; `markdown-url-fallback` probes `/index.md` only.) | Ship Tier 1 + manifest + middleware regardless (they satisfy the known checks); confirm weighting before investing in the Tier 2 converter | _pending_ |

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

**Where the 2026-08-16 phases slot in:** Phase 7 (serving-correctness groundwork) is immediate —
small, independently shippable, and it hardens artifacts that already exist. Phase 8 (`ax init`)
can land any time before the public `latest` and is most valuable before the Phase 3.5 canary
partners onboard. Phase 9 splits: Tier 1 + the manifest + `/auth.md` come before Phase 10 (the
middleware consumes the manifest); Tier 2 waits on the converter decision and open question #23.
Phase 10 follows Phase 9's manifest. Phases 5 (evals) and 6 (release/`latest`) remain the tail —
and the Phase 5 eval harness should exercise the twins/middleware fixtures once they exist, since
"an agent can actually retrieve the content" is precisely what those phases add.

**If timelines compress:** the shippable, useful v1 is **detect-and-reference alone** — site metadata
+ MCP-server detection + a `public/openapi.json` + config-declared docs/skills + `llms.txt`. That
already improves a site's Ora score. WebMCP discoverability is the near-future add; LLM-tier evals are
a first cut. Of the 2026-08-16 phases, Phase 7 is the keep-at-all-costs slice (correctness +
born-passing tests); wizard, twins, and middleware degrade gracefully to later releases.
