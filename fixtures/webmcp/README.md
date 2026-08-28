# fixture: webmcp

Both WebMCP registration shapes on one page — the merge of the old `webmcp-declarative` and
`webmcp-imperative` fixtures (the adversarial patterns that must NOT detect live in `edge-cases`).

- **Declarative** — the `<form toolname="subscribe_newsletter">` on `/`: read straight off the
  JSX, high-confidence, and the only WebMCP shape that yields a catalog entry (the page URL is the
  tool surface).
- **Imperative** — `document.modelContext.registerTool({ name: 'add_to_cart', ... })` in a
  `'use client'` component on the same page: detected as a tool name, surfaced in the report with
  the "invisible in server-rendered HTML" recommendation, but never invented into an entry.

Having both on the same route also pins their interaction: the `/` entry's capabilities list the
declarative tool only, while `report.webMcpToolNames` carries both.

**Exercises:** declarative form detection and page-URL entry emission, imperative call detection in
client modules, the recommendation-not-entry rule for imperative tools, and the two shapes
coexisting on one route.
