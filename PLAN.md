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

**Near-future (post-v1):**

- WebMCP discoverability — in-page `navigator.modelContext` tools and declarative `<form toolname>`.

**Out of scope:**

- **GraphQL.** Not idiomatic to Next.js, so the plugin does not emit `application/graphql` even though
  Ora's crawler ingests it for other stacks.
- Synthesizing an OpenAPI doc from bare route handlers, or any invented marker convention.

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

Ora also uses extension fields on entries (all legal — the spec allows unknown keys): `auth` (full
OAuth details), `capabilities` (tool-name list), `representativeQueries`, `provenance`, and
`trustManifest.attestations`. The plugin should populate the ones a site can self-declare (at least
`auth`, and `capabilities` for MCP) where cheap.

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

**Finding (verified 2026-07-16): the spec publishes NO formal schema.** The upstream
[Agent-Card/ai-catalog](https://github.com/Agent-Card/ai-catalog) repo contains only a prose spec
(`specification/ai-catalog.md`) and one example (`specification/examples/ai-catalog.json`) — no
JSON Schema, CDDL, or OpenAPI. Also note ADR-0011: upstream dropped the `.well-known`
*requirement*; the `.well-known/ai-catalog.json` location is an ARD-layer convention
(`specVersion: "1.0"` per agenticresourcediscovery.org).

- [ ] **Ask Ora first:** does their crawler/AgentJourney use an internal schema or validator for
      ai-catalog? If yes, that artifact is the real oracle — vendor it.
- [ ] Otherwise, hand-write a JSON Schema in `spec/` derived from the prose spec (§Top-Level
      Structure, §Host Info, §Catalog Entry, §Publisher Object, §Metadata Extensibility,
      §Version Handling), plus vendor the upstream example as a must-validate test case. Keep it
      deliberately permissive where the prose is ambiguous — reject only what the spec explicitly
      forbids. (Consider offering it upstream later; contributing a validator is spec-following,
      not spec-inventing.)
- [ ] Record the upstream commit the schema was derived from; upgrade policy: spec bumps are
      explicit PRs with a changelog entry, never silent updates.
- [ ] Validation helper: `validateCatalog(json)` → pass/fail + errors, backed by the schema (ajv
      or similar). This is the oracle everything else tests against.
- [ ] Treat catalog `type` fields as open string lists, not enums (IANA registrations not final).
- [ ] Trust Manifest / attestations (a large part of the spec): **out of scope for v1 emission**
      beyond not emitting anything that conflicts with it — confirm with Ora whether their score
      checks trust fields (relates to open question #10's "whole score" framing).

### 0.3 Decide the supported matrix

- [ ] Next.js: App Router only for v1 (Pages Router explicitly out of scope — confirm with Ora).
- [ ] Pin supported Next.js minors (e.g. 14.x, 15.x, canary-as-canary) and Node LTS versions.
- [ ] Decide monorepo (Turborepo) support level for v1: detect-and-warn vs full support.
- [ ] Write the matrix into README so it's a public contract from day one.

### 0.4 Scaffold the repo

- [ ] pnpm workspace: `packages/ora-catalog` (the plugin/CLI), `fixtures/*`, `spec/`.
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

- [x] CLI entry point: `npx ora-catalog` runnable as a postbuild step. (`packages/ora-catalog`:
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

**Decision (2026-07-19, superseding this section's original "validated with Zod" wording):** this
is build-time tooling, so dependency count matters (see *Core design decisions*). The package
already needs a JSON Schema validator for the AI Catalog spec itself (`ajv`) — a second, different
validator (`zod`) just for `ard.config` would be redundant, since Ajv validates any parsed
JS object regardless of whether it came from JSON or from executing a `.ts` file. So
`ard.config` is validated by a small hand-written JSON Schema (`src/config-schema.ts`)
through the same shared Ajv instance (`src/ajv-instance.ts`) as `validate.ts`. `jiti` is still a
new dependency — unavoidably so, since *something* has to execute a `.ts`/`.mjs`/`.cjs` config
file at runtime, which is an orthogonal problem to schema validation.

### 2.2 Zero-config inference & artifact detection (aligned with Ora's index)

Detect-and-reference is the cheapest, highest-value work — it mirrors exactly what Ora's crawler
already rewards. Zero-config, in rough priority order:

- [ ] Emit site-level metadata (name, domain, description from package.json / config).
- [ ] Detect an existing **MCP server** configured the Next.js way (`mcp-handler`, legacy alias
      `@vercel/mcp-adapter`) → `application/mcp-server-card+json`. Unambiguous intent to publish.
      Populate `capabilities` / `auth` where statically derivable.
- [ ] Detect a static **`public/openapi.json`** and reference its URL →
      `application/vnd.oai.openapi+json`. Details in Phase 3.
- [ ] Emit **docs** and **skills** entries (`text/html` / `application/ai-skill+md`) from URLs the
      developer **declares in `ard.config`**. Config-driven, not guessed — the developer knows
      where their docs and skills live; the plugin doesn't spider for them.
- [ ] Reference an existing **`llms.txt`** served the Next.js way — a route handler at
      `app/llms.txt/route.ts` (often `dynamic = 'force-static'`) or a static `public/llms.txt` →
      `text/markdown`. Scaffold a starter route handler when absent (v1; cheap, idiomatic).
- [ ] Do **not** synthesize an OpenAPI doc from bare route handlers; reference only a doc the app
      actually produces. Most route handlers are internal BFF endpoints and must not be exposed.
- [ ] Do **not** emit GraphQL entries — out of scope (see *Scope*).

### 2.3 Review-before-publish flow

- [ ] First run (no committed catalog present): print a full "about to expose" summary and write
      the catalog only after `--yes` / interactive confirm; CI mode requires the flag.
- [ ] Every run prints a build summary: `✓ N artifacts referenced (MCP/OpenAPI/docs/skills),
      K warnings`.

### 2.4 Emission targets

- [ ] Static file into `public/.well-known/` (default).
- [ ] Alternative: generate a route handler (`app/.well-known/ai-catalog.json/route.ts`) for
      `basePath`/proxy setups — also the future path to dynamic catalogs.
- [ ] Fixture + test for each target, including the `deploy-variants` fixture.

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

## Phase 4 — WebMCP detection

Goal: detect in-page WebMCP tools and include them in the same catalog. Goes late deliberately —
WebMCP is a W3C Community Group draft, behind a flag in Chrome, least-stable dependency.

- [ ] Declarative detector first (near-trivial, high-confidence): JSX `<form toolname=...>`.
- [ ] Imperative detector: `navigator.modelContext.registerTool(...)` call expressions in
      `'use client'` files — discovery via the same AST pass; tool metadata evaluated via the same
      subprocess convention where statically ambiguous.
- [ ] Warn on `registerTool` in a server component.
- [ ] Negative detection: user-defined `registerTool` functions must not match (fixture exists).
- [ ] **No WebMCP skill inference, no `defineSkill` invention.** If/when WebMCP standardizes skills,
      add a detector then. (Distinct from the `application/ai-skill+md` *agent-skills-repo* detection
      in 2.2 — that's a real artifact Ora indexes, not an invented WebMCP spec point.)
- [ ] Tests: fixture snapshots for `webmcp-imperative`, `webmcp-declarative`, `edge-cases`.

**Done when:** both WebMCP fixtures emit correct entries; edge-case fixture emits zero false
positives.

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
- [ ] Dist-tags: `canary` → Ora's own site + 1–2 friendly partners run it before `latest`. With
      near-zero ecosystem adoption of the spec, these first users are the real integration test.
- [ ] Docs generated from fixtures (guaranteed-working examples): quickstart, artifact detection
      (MCP/OpenAPI/docs/skills), config reference, denylist/security defaults, drift-diff reading
      guide, `basePath`/deployment
      notes, degradation policy.
- [ ] Developer-facing SKILL.md / setup guide for coding agents — written last, once the config
      surface stabilizes.
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
| 7 | Package name / npm scope / who owns publish rights? | — | _pending_ |
| 8 | Real-LLM eval budget + which model/provider? | Nightly + pre-release only | _pending_ |
| 9 | Timeline expectations per phase? | Skeleton wk 1; Phases 2–3 are the bulk | _pending_ |
| 10 | Which artifacts should the plugin emit/reference? | **Resolved (2026-07-16):** Ora confirmed the crawler ingests the first-party `/.well-known/ai-catalog.json`, `openapi.json`, `/graphql`, and `llms.txt`. The plugin emits the Next-idiomatic subset — MCP + `public/openapi.json` + config-declared docs/skills now; WebMCP + `llms.txt` generation next; **GraphQL out** (not idiomatic Next). Sitemap = detect + recommend `next-sitemap`, don't reimplement. | **confirmed** |
| 11 | API access to AgentJourney (journey.ora.ai) for automated evals? | Yes — use it as the nightly real-LLM eval harness | _pending_ |
| 12 | Does Ora's crawler/scorer use an internal ai-catalog schema or validator? (Spec publishes none — verified) | If yes, vendor theirs as the oracle; if no, we hand-write one and offer it upstream | _pending_ |
| 13 | Is the agent-readiness score essentially a **checklist of artifact types** (OpenAPI / MCP / GraphQL / llms.txt / docs / skills)? Top-site data suggests breadth drives the grade. | If yes, target the checklist directly and report per-artifact coverage in the build summary. | _pending_ |
| 14 | Which of Ora's entry **extension fields** should a first-party catalog self-declare? (`auth`, `capabilities`, `representativeQueries`, `provenance`, `trustManifest.attestations`) | Emit the self-declarable ones (`auth`, `capabilities` for MCP) where cheap; leave Ora-side scoring fields to Ora. | _pending_ |
| 15 | Agent **skills** (`application/ai-skill+md`): does Ora expect skills in a published GitHub repo, and should the plugin help scaffold/reference one? | Detect-and-reference a skills repo if present; do not invent skills. Scaffolding = later. | _pending_ |

---

## Sequencing logic (why this order)

Fixtures → skeleton → catalog core → OpenAPI detection → WebMCP → evals, ordered by risk-of-rework:
the skeleton de-risks the untested Ora-crawler integration in week one; the catalog core — centered on
**detect-and-reference** of the Next-idiomatic artifacts (MCP, `public/openapi.json`, config-declared
docs/skills) — is stable regardless of spec churn and is the cheapest high-value work; OpenAPI
detection reuses the same detect-and-reference machinery; WebMCP depends on the least-stable spec so it
goes late; evals only make sense once there's real output to consume.

**If timelines compress:** the shippable, useful v1 is **detect-and-reference alone** — site metadata
+ MCP-server detection + a `public/openapi.json` + config-declared docs/skills + `llms.txt`. That
already improves a site's Ora score. WebMCP discoverability is the near-future add; LLM-tier evals are
a first cut.
