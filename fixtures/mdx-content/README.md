# fixture: mdx-content

An App Router app wired with `@next/mdx` (`pageExtensions` includes `md`/`mdx`), exercising
**Tier 1** of the markdown-twin ladder — twins derived from markdown-shaped sources, no HTML
conversion involved:

- `app/guide/page.mdx` — mostly markdown (one stripped `export`), so its twin is derived straight
  from the source: highest fidelity, works with zero build output.
- `app/widgets/page.mdx` — component-heavy MDX (**skip: mostly-jsx** at the ≤25% non-markdown
  threshold): stripping its components would silently omit what the page shows, so ax recommends
  moving the prose into markdown instead of guessing.
- `app/page.tsx` — an ordinary prerendered page, proving Tier 1 and Tier 2 coexist in one build.

**Exercises:** MDX route detection gated on `pageExtensions`, the mostly-markdown threshold, and
the Tier-1 twin snapshot under `twins.golden/`.
