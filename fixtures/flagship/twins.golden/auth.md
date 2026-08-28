---
title: "Authentication — flagship"
description: "How to obtain access to the gated surfaces on this site."
canonical_url: https://flagship-fixture.example.com/auth.md
last_updated: <last_updated>
generated-by: "@ora-ai/ax-nextjs"
---

# Authentication

flagship has 1 gated surface. This document is generated at build time from the site's own committed auth declarations — it describes how to authenticate and never contains credentials.

## MCP server at /api/mcp

An MCP (Model Context Protocol) server. Connecting requires authentication.

- Auth: OAuth 2.0
- Auth requirements (RFC 9728 protected-resource metadata): [/.well-known/oauth-protected-resource](https://flagship-fixture.example.com/.well-known/oauth-protected-resource)
- Get access: <https://flagship-fixture.example.com/agents.md>
