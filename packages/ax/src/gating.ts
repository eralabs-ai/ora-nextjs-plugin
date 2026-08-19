const GLOB_SPECIAL = new Set(['.', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

/**
 * Converts a small glob subset (`*` = any run of non-`/` characters, `**` = anything including
 * `/`) into a RegExp anchored to the whole path. Intentionally minimal — just enough for the
 * default-gated path patterns like `/api/auth/**` — not a general-purpose glob library, to keep
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
 * What an `isGated` check is asked about: the kind of artifact, the URL pathname it serves at, and
 * (for MCP) the tool names it exposes. `path` is always a server-relative pathname (e.g.
 * `/api/mcp`), never an absolute URL, so a matcher can be written against paths without parsing
 * origins.
 */
export interface GateTarget {
  kind: 'mcp' | 'openapi' | 'entry';
  path: string;
  tools?: string[];
}

/**
 * A whole-artifact gating predicate the developer supplies via `ax.config` `isGated`. Returns
 * `true` when the target is behind auth (must not be advertised as an open surface). Boolean and
 * whole-artifact: auth is declared per server in the MCP conventions, so gating is per surface,
 * never per tool.
 */
export type IsGated = (target: GateTarget) => boolean;

/**
 * The default-on safety floor: auth and webhook routes are never safe to advertise as an open
 * surface, so they're gated even with zero config. This is the successor to the old
 * `DEFAULT_DENYLIST` — a developer-supplied `isGated` replaces it wholesale (call `defaultIsGated`
 * from your own matcher to keep the floor).
 */
export const DEFAULT_GATED_GLOBS: readonly string[] = ['/api/auth/**', '/api/webhooks/**'];

/** The built-in floor as an {@link IsGated}: gates the {@link DEFAULT_GATED_GLOBS} paths. */
export function defaultIsGated(target: GateTarget): boolean {
  return matchesAnyGlob(target.path, DEFAULT_GATED_GLOBS);
}

/**
 * Resolves the effective gating predicate. A developer-supplied `isGated` owns the whole policy
 * (mirroring the old "a user `denylist` replaces the default" behavior, and letting a matcher
 * *re-include* a floor path by returning `false` — the job the old `allowlist` did). With no
 * `isGated`, the built-in {@link defaultIsGated} floor applies.
 */
export function resolveGating(isGated: IsGated | undefined): IsGated {
  return isGated ?? defaultIsGated;
}
