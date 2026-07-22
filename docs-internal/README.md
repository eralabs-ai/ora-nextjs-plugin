# docs-internal

Internal planning and strategy docs. **Everything in this folder is excluded from any public
release or public mirror of this repository** — it is for the team (and Ora, our collaborator) only.

Why it exists: some of this material is candid in ways that shouldn't be published as-is — internal
notes on Ora's scoring, open questions still being confirmed with Ora, go-to-market/partner framing,
and competitive analysis. The repo stays the private source of truth; when we open-source, we cut a
**fresh curated public mirror** that omits this folder (and replaces `PLAN.md` with a sanitized,
public `ROADMAP.md`) rather than making this repo public or rewriting its history.

Contents:

- `PLAN.md` — the phased development plan (the roadmap of record, internal).

Rules of thumb:

- Put any internal/candid planning notes **here**, not in root-level or user-facing docs.
- Don't link to files in this folder from anything that ships publicly (README, published package,
  source-comment citations meant for public code). Source comments currently cite `PLAN.md` section
  numbers — reconcile those as part of the public-mirror curation, not before.
