import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** A file found by `walkFiles`, both as an absolute path and relative to the walked root. */
export interface WalkedFile {
  absolutePath: string;
  /** Directory containing the file, relative to `root`, using this platform's separator. */
  relativeDir: string;
}

// Directories a detector scanning `app/` (or a future WebMCP scan of the whole project) should
// never descend into: dependency trees, VCS metadata, and build/cache output. None of these can
// contain a real Next.js route or component the plugin should detect, and node_modules in
// particular can be enormous — skipping it by name (not by pattern) keeps this walk cheap and
// bounded regardless of an app's size.
const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.turbo',
  '.vercel',
  '.cache',
  'dist',
  'build',
  'coverage',
  'out',
]);

/**
 * Recursively walks `root`, returning every file whose name satisfies `isMatch`. Directories in
 * `ignoredDirs` (default: `DEFAULT_IGNORED_DIRS`) and any hidden directory (leading `.`) are
 * skipped entirely. An unreadable directory (permissions, a broken symlink, ...) is skipped rather
 * than thrown — this is best-effort detection, never a build-breaking scan.
 */
export function walkFiles(
  root: string,
  isMatch: (fileName: string) => boolean,
  ignoredDirs: ReadonlySet<string> = DEFAULT_IGNORED_DIRS,
): WalkedFile[] {
  const results: WalkedFile[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || ignoredDirs.has(entry.name)) continue;
        stack.push(join(dir, entry.name));
      } else if (entry.isFile() && isMatch(entry.name)) {
        results.push({ absolutePath: join(dir, entry.name), relativeDir: relative(root, dir) });
      }
    }
  }

  return results;
}

/** Splits a `relativeDir` from `walkFiles` into its path segments, ignoring empty ones. */
export function pathSegments(relativeDir: string): string[] {
  return relativeDir.split(sep).filter((segment) => segment !== '');
}

/** File names the App Router recognizes as a route handler, across every supported extension. */
export const ROUTE_FILE_NAMES: ReadonlySet<string> = new Set([
  'route.ts',
  'route.tsx',
  'route.js',
  'route.jsx',
  'route.mjs',
  'route.cjs',
]);
