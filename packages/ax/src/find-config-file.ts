import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Extensions checked for both `next.config.*` and `ax.config.*`, in lookup order. */
export const CONFIG_FILE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.mts',
  '.cts',
  '.mjs',
  '.js',
  '.cjs',
];

/** Returns the first `<cwd>/<basename><ext>` that exists, or undefined if none do. */
export function findConfigFile(
  cwd: string,
  basename: string,
  extensions: readonly string[] = CONFIG_FILE_EXTENSIONS,
): string | undefined {
  for (const ext of extensions) {
    const candidate = join(cwd, `${basename}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
