---
title: 'MCP Multi-Server Fixture'
description: 'A Next.js app hosting two MCP servers: one public, one gated via withMcpAuth.'
canonical_url: https://mcp-multi-fixture.example.com/
last_updated: 2026-08-23T15:06:18.994Z
generated-by: '@ora-ai/ax'
---

# MCP multi-server fixture

Two MCP servers: a public one at /api/public/mcp and one gated behind OAuth via `withMcpAuth` at /api/mcp. ax emits one server card per server — the primary (public) card at the root well-known path, and each server's card at its named slot.
