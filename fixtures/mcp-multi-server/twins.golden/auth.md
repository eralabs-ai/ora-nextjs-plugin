---
title: "Authentication — mcp-multi-server"
description: "How to obtain access to the gated surfaces on this site."
canonical_url: https://mcp-multi-fixture.example.com/auth.md
last_updated: <last_updated>
generated-by: "@ora-ai/ax"
---

# Authentication

mcp-multi-server has 1 gated surface. This document is generated at build time from the site's own committed auth declarations — it describes how to authenticate and never contains credentials.

## MCP server at /api/mcp

An MCP (Model Context Protocol) server. Connecting requires authentication.

- Auth: required — the scheme is not statically derivable from the source
- Auth requirements (RFC 9728 protected-resource metadata): [/.well-known/oauth-protected-resource](https://mcp-multi-fixture.example.com/.well-known/oauth-protected-resource)
- Get access: not documented yet. (Site owner: declare `auth.docsUrl` on this entry in ax.config to link where credentials are obtained.)
