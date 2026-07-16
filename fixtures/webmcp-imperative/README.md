# fixture: webmcp-imperative

A client component that registers an in-page tool via `navigator.modelContext.registerTool(...)`.

**Exercises:** the Phase 4 imperative WebMCP detector — finding the `registerTool` call expression in
a `'use client'` module. `types/webmcp.d.ts` supplies just enough ambient typing for the draft API to
compile; detection keys on the call, not the types.
