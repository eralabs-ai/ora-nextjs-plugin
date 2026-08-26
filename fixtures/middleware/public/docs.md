# Docs (hand-authored twin)

This file is written and maintained by a human — it has no `generated-by` marker, so ax records it
as the markdown source for `/docs` and never overwrites it. Because it is committed, the prebuild
`ax manifest` run lists it on the very first build, which is what lets the dual-fetch dogfood
prove the middleware rewrite without a second build.

- Agents and `Accept: text/markdown` requesters receive this document at `/docs`.
- Browsers receive the HTML page.
