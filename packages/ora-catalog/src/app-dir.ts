import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Locates the project's App Router root: `app/` or `src/app/` (Next.js supports both; it forbids
 * having both at once, so root `app/` is checked first and either match is unambiguous). Returns
 * undefined if neither exists — a normal case for a project this plugin has nothing to scan
 * (e.g. a Pages Router app, or a fixture with no routes at all).
 */
export function findAppDir(cwd: string): string | undefined {
  for (const candidate of [join(cwd, 'app'), join(cwd, 'src', 'app')]) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  return undefined;
}
