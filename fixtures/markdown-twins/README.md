# fixture: markdown-twins

An App Router app exercising every rung of the markdown-twin ladder in one build:

- `/` and `/guides/setup` — prerendered pages with a `<main>` full of real prose (**Tier 2 happy
  path**: twins derived from the build output's HTML).
- `/hand` — a prerendered page whose markdown twin is the hand-written `public/hand.md`
  (**Tier 1 user-owned**: no `generated-by` marker, so ax records it and never touches it).
- `/shell` — a `<main>` with almost no text and no page-owned metadata (**skip: too-little-text**
  — a JS-shell twin would be an empty page presented as content).
- `/live` — the same empty shell but structured the recommended way: a server `page.tsx` exporting
  the page's own `metadata` and rendering the client part (**metadata rung**: a minimal twin
  derived from the metadata, explicit about describing rather than mirroring the page).
- `/private` — gated by the fixture's `isGated` (**skip: gated** — a gated page's prerender is a
  login shell; never derive a twin from it).
- `/blog/[slug]` — a dynamic route (**Tier 3 refusal**: no statically knowable URL, counted and
  recommended, never guessed).

**Exercises:** twin generation + skip reasons in `.ax/report.json`, the twin snapshots under
`twins.golden/` (normalized `last_updated`), and the born-passing frontmatter assertions.
