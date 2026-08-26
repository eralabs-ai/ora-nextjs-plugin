# fixture: agent-skills

A Next.js app that publishes [Agent Skills](https://github.com/example/agent-skills)-style
`SKILL.md` files via `ax.config`'s `publishSkills: true`.

**Exercises:**

- **Publish-plan create path** — two skills under `skills/` (`getting-started`, `api-integration`)
  have no prior published copy, so both plan as `create`. `api-integration/SKILL.md` carries no
  `description:` frontmatter, exercising the body-first-paragraph description fallback.
- **Index generation** — `public/.well-known/agent-skills/index.json` lists both skills sorted by
  name, each with its root-relative URL and `sha256:` content digest.
- **`.claude` exclusion** — `.claude/skills/internal-only/SKILL.md` exists but is never scanned by
  the zero-config publish path (auto-discovery only walks `skills/`), so it never appears in the
  index or under `public/`.
- **Spec media type** — the hand-declared skills-repo entry in `ax.config.ts` uses
  `application/agent-skills+md`, the current Agent Skills spec media type, rather than the legacy
  `application/ai-skill+md` the `config-overrides` fixture still exercises on purpose.
- **`ax:docs` tag** — a hand-declared `text/html` entry tagged `tags: ['ax:docs']` flips the
  report's `docs` artifact (and Ora's `public-api-docs` check) to addressed.

Ships an `ax.config.ts` declaring `siteUrl` so the emitted entries' identifiers and URLs are
deterministic in CI (without it, this fixture's detectors still run, but skip emitting URL-bearing
entries since none of this repo's test environments set Vercel's production-domain env var).

The published output under `public/.well-known/agent-skills/` is build output, not a fixture
source file — it's gitignored and pinned instead under the committed `skills.golden/`, the way
`cards.golden/` pins MCP server cards.
