---
title: "The MDX guide"
canonical_url: https://mdx-content-fixture.example.com/guide
last_updated: <last_updated>
generated-by: "@ora-ai/ax"
---

# The MDX guide

This page's content lives as markdown in the repo, so its twin is derived straight from this
source — the highest-fidelity rung of the ladder, needing no build output and no HTML conversion.

## Why source beats reconstruction

A twin converted from rendered HTML is a reconstruction; this file _is_ the content. The one
non-markdown line above (the `metadata` export) is stripped, and it stays comfortably under the
mostly-markdown threshold.

## Things this guide covers

- Deriving twins from `page.mdx` sources.
- The `pageExtensions` gate that proves the page actually routes.
- The frontmatter contract every generated twin carries.

```bash
npx ax --report
```

That is everything an agent needs to read this page without parsing HTML.
