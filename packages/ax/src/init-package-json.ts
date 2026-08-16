// Decides how `ax init` wires the build. The rule mirrors the scaffolds' "never edit a file you
// don't own" posture: ax adds a `postbuild` script only when there isn't one, because `postbuild`
// is the slot npm reserves for exactly this. When a `postbuild` already exists it belongs to the
// developer — chaining ax into it silently is the same overreach as editing someone's layout.tsx,
// so ax prints the one-line edit instead and lets them apply it.
//
// This is the piece that actually kills the setup friction: `postbuild` runs wherever `build` runs
// (Vercel, CI), so a team that never builds locally still gets every artifact regenerated on deploy.

/** The command ax wires into `postbuild`. Bare `ax` — same as the README quickstart. */
export const POSTBUILD_COMMAND = 'ax';

export type PostbuildWiring =
  /** No `postbuild` existed; caller should write `scripts.postbuild = "ax"`. */
  | { action: 'add' }
  /** A `postbuild` already runs `ax` (in some form); nothing to do. */
  | { action: 'already-wired' }
  /**
   * A different `postbuild` exists — ax won't touch it. `existing` is the current command and
   * `instruction` is the exact human-readable edit to make.
   */
  | { action: 'manual'; existing: string; instruction: string };

/** True if a shell command runs `ax` as a command word (bare, path form, or via `npx`/`pnpm`/etc.). */
function invokesAx(command: string): boolean {
  const tokens = command.split(/[\s;&|]+/).filter((t) => t !== '');
  return tokens.some((token) => token === 'ax' || token.endsWith('/ax') || token.endsWith('\\ax'));
}

/**
 * Given the current `scripts` block, decide the postbuild wiring. Pure so the decision is testable
 * without touching disk; the caller performs the write (only for `add`).
 */
export function planPostbuildWiring(scripts: Record<string, unknown> | undefined): PostbuildWiring {
  const existing = scripts?.postbuild;
  if (typeof existing !== 'string' || existing.trim() === '') {
    return { action: 'add' };
  }
  // Already invokes ax — leave it alone. Tokenize on whitespace and shell chain operators, then look
  // for `ax` as a whole command word: bare `ax`, a path form (`node_modules/.bin/ax`), or a runner's
  // second token (`npx ax`). Word-level, not substring, so `relax`/`axe` don't false-match.
  if (invokesAx(existing)) {
    return { action: 'already-wired' };
  }
  return {
    action: 'manual',
    existing,
    instruction:
      `Your package.json already has a "postbuild" script (${JSON.stringify(existing)}). ` +
      `Add ax to it so the catalog regenerates on every build, e.g.: ` +
      `"postbuild": ${JSON.stringify(`${existing} && ${POSTBUILD_COMMAND}`)}`,
  };
}
