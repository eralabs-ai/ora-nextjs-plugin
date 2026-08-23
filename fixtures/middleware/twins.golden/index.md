---
title: "Middleware Fixture"
description: "Exercises the @ora-ai/ax/middleware negotiation entry against a real next build."
canonical_url: https://middleware-fixture.example.com/
last_updated: <last_updated>
generated-by: "@ora-ai/ax"
---

# Middleware fixture

This prerendered homepage gets a generated markdown twin on the postbuild run. On a fresh checkout the prebuild manifest does not list that twin yet (it is generated after this build), so the middleware serves this HTML to everyone until the next build — the documented one-build staleness, and the reason the dogfood probes target the hand-authored docs twin instead.

Enough prose lives here to clear the twin pass's minimum-content guard, so the homepage twin lands in this fixture's golden snapshots.
