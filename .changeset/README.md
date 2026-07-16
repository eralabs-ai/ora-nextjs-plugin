# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) — one Markdown file per
pending release note. Run `pnpm changeset` to add one describing a user-facing change; CI turns the
accumulated changesets into version bumps and `CHANGELOG.md` entries at release time.

Per the plan's release discipline: catalog **output** changes are ≥ minor, breaking config changes
are major, and spec-version bumps are called out explicitly in the changeset body.
