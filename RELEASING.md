# Releasing `@ora-ai/ax-nextjs`

Publishing is fully automated through [changesets](https://github.com/changesets/changesets)
and GitHub Actions (`.github/workflows/release.yml`). Nobody publishes from a laptop —
npm **provenance** is enabled, which only works from CI.

## One-time setup (npm org owner)

1. Create a **granular automation token** on npmjs.com with read/write access to the
   `@ora-ai` scope (Profile → Access Tokens → Generate New Token → Granular).
2. Add it to this repo as the `NPM_TOKEN` Actions secret
   (Settings → Secrets and variables → Actions).

That's it. The first publish creates the `@ora-ai/ax-nextjs` package on the registry.

## How a release happens

1. Every feature PR includes a changeset (`pnpm changeset`) declaring its bump
   (patch/minor/major) and a human-readable summary.
2. On every push to `main`, the Release workflow maintains a standing
   **"Version Packages" PR** that rolls up all pending changesets into a version
   bump + CHANGELOG entry.
3. **Merging that PR is the release.** The workflow builds and runs
   `changeset publish`, which publishes to npm with provenance.

## Canary line (current state)

The repo is in changesets **pre-release mode** (`.changeset/pre.json`) with the
`canary` tag. Versions publish as `0.1.0-canary.N` under the **`canary` dist-tag**,
so a plain `npm install @ora-ai/ax-nextjs` resolves nothing until a real `latest`
exists — only an explicit `@canary` install gets the prerelease.

Install for partners: `npm install @ora-ai/ax-nextjs@canary`

## Promoting canary → latest

When a canary has proven itself (Phase 6 of the plan):

```sh
pnpm changeset pre exit
git commit -am "chore: exit canary pre-release mode"
```

Merge that to `main`; the next "Version Packages" PR produces a stable version
(e.g. `0.1.0`) which publishes under `latest`.

## Ground rules

- Strict semver: catalog output changes ≥ minor; breaking config changes = major;
  ARD spec-version bumps called out explicitly in release notes.
- The `files` allowlist in `packages/ax/package.json` is `["dist"]` — check the
  tarball (`pnpm --filter @ora-ai/ax-nextjs pack`) before promoting to `latest`.
