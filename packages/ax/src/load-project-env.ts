import { createRequire } from 'node:module';
import { join } from 'node:path';

type LoadEnvConfig = (
  dir: string,
  dev?: boolean,
  log?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
) => unknown;

interface NextEnvModule {
  loadEnvConfig?: LoadEnvConfig;
  default?: { loadEnvConfig?: LoadEnvConfig };
}

const silentLog = { info: (): void => {}, error: (): void => {} };

/**
 * Loads the project's `.env*` files into `process.env` the way `next build` does, by reusing the
 * app's own `@next/env` (the loader Next itself uses) — so `SITE_URL` / `NEXT_PUBLIC_SITE_URL` (and
 * any variable an `ax.config` reads via `process.env`) resolve during a standalone `postbuild` run,
 * not only when set inline on the command line. The CLI is its own process, separate from the
 * `next build` that loaded these files, so without this they'd be absent.
 *
 * Uses the project's installed `@next/env` rather than a bundled copy or a hand-rolled dotenv parser:
 * it matches Next's exact file precedence (`.env.local`, `.env.production`, ...) and variable
 * expansion, and never overrides an already-set variable (so an inline/exported value still wins).
 * `@next/env` ships as CommonJS, so we `require` it (rather than dynamic `import`, whose CJS interop
 * would bury `loadEnvConfig` under `.default`); we still read `.default` as a fallback in case a
 * future build ships an ESM wrapper. Best-effort: if it can't be resolved (not a Next project, or
 * unusual hoisting) this is a no-op and callers fall back to whatever is already in `process.env` —
 * it never throws.
 */
export function loadProjectEnv(cwd: string): void {
  try {
    const require = createRequire(join(cwd, 'package.json'));
    const mod = require('@next/env') as NextEnvModule;
    const loadEnvConfig = mod.loadEnvConfig ?? mod.default?.loadEnvConfig;
    loadEnvConfig?.(cwd, false, silentLog);
  } catch {
    // No resolvable @next/env — leave process.env as-is.
  }
}
