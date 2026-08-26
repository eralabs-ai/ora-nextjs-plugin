---
name: internal-only
description: A local-session-only skill that must never appear in the published skills index.
---

# Internal only

This skill lives under `.claude/skills/`, not `skills/`, so `ax`'s zero-config publish path never
picks it up — auto-discovery only scans `skills/`. It exists purely to prove that a
`.claude/skills/` entry stays unpublished even when `publishSkills: true` is set for the rest of
the repo; publishing it would require listing its path explicitly in `publishSkills`, which this
fixture's `ax.config.ts` deliberately does not do.
