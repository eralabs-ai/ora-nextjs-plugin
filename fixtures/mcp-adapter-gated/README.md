# fixture: mcp-adapter-gated

A Next.js app hosting an MCP server via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler),
gated behind OAuth with `withMcpAuth` — the sibling of the `mcp-adapter` fixture that exercises the
**gated** MCP path.

**Exercises:** static auth detection. The `[transport]` route wraps its handler in
`withMcpAuth(handler, verifyToken, { resourceMetadataPath: '/.well-known/oauth-protected-resource' })`.
ax detects the wrapper textually and:

- emits the MCP catalog entry with `auth: { status: "unknown" }` — it requires auth, but ax can't
  probe the live server for the OAuth endpoints at build time, so it never guesses `api_key`/`none`
  and never advertises the server as open;
- cross-links the RFC 9728 metadata on the well-known server card as
  `authentication: { required: true, resourceMetadata: ".../.well-known/oauth-protected-resource" }`.

Ships an `ax.config.ts` declaring `siteUrl` so the emitted output is deterministic in CI. Contrast
with `mcp-adapter`, whose (un-wrapped) mount carries no `auth` block at all.
