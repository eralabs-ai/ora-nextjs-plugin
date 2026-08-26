---
'@ora-ai/ax-nextjs': minor
---

**Breaking (pre-1.0):** removed support for the legacy `ard.config.*` config file and its
deprecated `Ard*` aliases (`ArdConfig`, `ArdEntryOverride`, `ResolvedArdConfig`, `ArdConfigError`,
`loadArdConfig`, `validateArdConfig`, `ardConfigSchema`). `ard.config.*` was `ax.config.*`'s
pre-2026-07-27 name, kept only as a temporary migration aid; carrying a second config surface (and
its dual-file precedence/warning logic) indefinitely cost more than the one-line rename it covered
for.

Migration: rename `ard.config.*` to `ax.config.*`. A project that still has only an `ard.config.*`
now fails the build loudly — `loadAxConfig` throws `AxConfigError` naming the file and the rename —
rather than silently building with defaults and dropping the file's settings. A project with both
files is unaffected: `ax.config.*` already won and the `ard.config.*` was already ignored.
