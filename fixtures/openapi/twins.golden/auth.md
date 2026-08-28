---
title: "Authentication — openapi"
description: "How to obtain access to the gated surfaces on this site."
canonical_url: https://openapi-fixture.example.com/auth.md
last_updated: <last_updated>
generated-by: "@ora-ai/ax-nextjs"
---

# Authentication

openapi has 1 gated surface. This document is generated at build time from the site's own committed auth declarations — it describes how to authenticate and never contains credentials.

## HTTP API (described by /openapi.json)

The HTTP API documented by [/openapi.json](https://openapi-fixture.example.com/openapi.json) requires authentication; the OpenAPI document declares the scheme(s).

- Auth: OAuth 2.0
- Authorization endpoint: <https://example.com/oauth/authorize>
- Token endpoint: <https://example.com/oauth/token>
- Scopes: `read:echo`, `write:echo`
- Get access: sign in through your MCP client via OAuth — no manually issued credentials.
