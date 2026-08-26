import type { AxConfig } from '@ora-ai/ax';

// `siteUrl` makes the fixture deterministic regardless of where it's built (CI, a laptop, ...) —
// see fixtures/llms-txt/ax.config.ts for why. It also fixes the `urn:air:<publisher>:...`
// identifiers the hand-declared `entries` below use, since `buildUrn` derives the publisher
// segment from this same host.
const config: AxConfig = {
  siteUrl: 'https://agent-skills-fixture.example.com',

  // Opts into the zero-config publish path: every `skills/<name>/SKILL.md` in this repo (not
  // `.claude/skills/`, which auto-discovery never reaches into — see .claude/skills/internal-only)
  // gets copied to `public/.well-known/agent-skills/<name>/SKILL.md` and listed in the discovery
  // index, sorted by name.
  publishSkills: true,

  entries: [
    // A skills-repo pointer, distinct from the auto-published discovery index above: this one
    // points off-site at a GitHub repo of skills, using the Agent Skills spec's markdown media
    // type rather than the legacy `application/ai-skill+md` the config-overrides fixture still
    // exercises (that fixture is intentionally left on the old type). New config should prefer
    // this one.
    {
      identifier: 'urn:air:agent-skills-fixture.example.com:skills-repo',
      type: 'application/agent-skills+md',
      displayName: 'Agent skills repo',
      url: 'https://github.com/example/agent-skills',
    },
    // `tags: ['ax:docs']` is the one signal that flips the `docs` artifact (and Ora's
    // `public-api-docs` check) to addressed — ax never guesses docs from routes, so a real site
    // needs an entry tagged like this too, whether hand-declared here or written by `ax init`.
    {
      identifier: 'urn:air:agent-skills-fixture.example.com:docs',
      type: 'text/html',
      displayName: 'Site documentation',
      url: 'https://agent-skills-fixture.example.com/docs',
      tags: ['ax:docs'],
    },
  ],
};

export default config;
