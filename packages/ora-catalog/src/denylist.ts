const GLOB_SPECIAL = new Set(['.', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

/**
 * Converts a small glob subset (`*` = any run of non-`/` characters, `**` = anything including
 * `/`) into a RegExp anchored to the whole path. Intentionally minimal — just enough for
 * denylist/allowlist patterns like `/api/auth/**` — not a general-purpose glob library, to keep
 * this near-zero-dependency build tool from pulling one in for a handful of path patterns.
 */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
      } else {
        source += '[^/]*';
      }
    } else if (GLOB_SPECIAL.has(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`);
}

/** True if `path` matches any of the given glob patterns. */
export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

/**
 * True if `path` should be excluded: it matches the denylist and isn't re-included by the
 * allowlist. Allowlist always wins over denylist — PLAN.md 2.1: "Denylist support, with a
 * default-on denylist ...; allowlist to re-include."
 */
export function isPathDenied(
  path: string,
  denylist: readonly string[],
  allowlist: readonly string[],
): boolean {
  if (matchesAnyGlob(path, allowlist)) return false;
  return matchesAnyGlob(path, denylist);
}
