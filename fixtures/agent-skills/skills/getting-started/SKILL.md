---
name: getting-started
description: Walks a coding agent through cloning this fixture site and running its dev server.
---

# Getting started

Use this skill when you've been pointed at the agent-skills fixture and need to get it running
locally before making a change.

1. Install dependencies with `pnpm install` from the repo root.
2. Run `pnpm --filter @ax-fixtures/agent-skills dev` and open the printed local URL.
3. Edit files under `app/` — the dev server picks up changes without a restart.

There is no build step required for local iteration; `next build` is only needed to reproduce the
published catalog and skills index this fixture snapshots.
