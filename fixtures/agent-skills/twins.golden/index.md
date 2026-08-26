---
title: "Agent Skills Fixture"
description: "A Next.js app that publishes agent skills alongside its docs and skills-repo pointer."
canonical_url: https://agent-skills-fixture.example.com/
last_updated: <last_updated>
generated-by: "@ora-ai/ax"
---

# Agent skills fixture

Ships two skills under `skills/` that `publishSkills: true` publishes to `/.well-known/agent-skills/`, plus a third under `.claude/skills/` that stays private since auto-discovery never reaches into `.claude`.
