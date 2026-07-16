# fixture: edge-cases

Adversarial WebMCP-detection patterns that must **not** produce false positives — the negative-space
proof for the detection pass.

**Exercises:**

- `app/_cases/conditional-tools.tsx` — `registerTool` gated behind a feature flag (conditional
  registration).
- `app/_cases/server-register.tsx` — `registerTool` in a **server** component (no `'use client'`):
  must WARN, must not publish.
- `app/_cases/user-defined-register.ts` — a decoy user-defined `registerTool` function: must **not**
  be detected.
