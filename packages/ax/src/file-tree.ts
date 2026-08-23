// A `tree`-style renderer for the *files a run wrote* — the counterpart to route-tree.ts, which
// renders served URL paths. Where route-tree exists to serve a gating decision (checkbox on a
// server node), this one exists to replace flat "✓ wrote <path>" line lists: after a build or an
// `ax init`, a developer wants to see the *shape* of what landed on disk (which directories, how
// deep, which files carry a size or a warning) at a glance, and a nested tree reads that far faster
// than a column of absolute-looking paths.
//
// It is a pure function of its input so it can be unit-tested without touching the filesystem: the
// caller hands it cwd-relative POSIX-ish paths (`public/.well-known/mcp/server-card.json`) plus an
// optional already-formatted annotation string per file, and gets back plain lines with NO `[ax] `
// prefix — every caller adds its own prefix and indent.
//
// Two layout rules, chosen to match how `tree --prune` and GitHub's file browser render, so the
// output looks familiar rather than invented:
//   1. Sort is a single alphabetical `localeCompare` on the segment name, directories and files
//      interleaved (no "dirs first" grouping). One rule is easier to reason about than two, and it
//      means a file and a same-named directory land next to each other predictably (a directory
//      name that is a prefix of a file name sorts first, the natural `localeCompare` result).
//   2. A chain of directories where each has exactly one child *directory* collapses into one
//      segment (`public/.well-known/mcp/`), so deep single-child nesting doesn't waste a line per
//      level. Collapsing stops at the first directory that has a file child or more than one child —
//      a directory holding a single *file* stays expanded (that is not a chain of directories).

/** One file to place in the tree: a cwd-relative path and an optional pre-formatted annotation. */
export interface FileTreeEntry {
  /** cwd-relative, `/`-separated path, e.g. `public/.well-known/ai-catalog.json`. */
  path: string;
  /** Rendered after the filename as `name — annotation` (em-dash, matching the size lines). */
  annotation?: string;
}

/** A node in the intermediate tree. `name` may hold several segments once a chain is collapsed. */
interface TreeNode {
  name: string;
  isFile: boolean;
  annotation?: string;
  children: Map<string, TreeNode>;
}

/** Parses the flat entry list into a forest of top-level roots (one per distinct first segment). */
function buildForest(entries: FileTreeEntry[]): TreeNode[] {
  const roots = new Map<string, TreeNode>();
  for (const entry of entries) {
    const segments = entry.path.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;
    let level = roots;
    segments.forEach((segment, index) => {
      let node = level.get(segment);
      if (node === undefined) {
        node = { name: segment, isFile: false, children: new Map() };
        level.set(segment, node);
      }
      if (index === segments.length - 1) {
        node.isFile = true;
        if (entry.annotation !== undefined) node.annotation = entry.annotation;
      }
      level = node.children;
    });
  }
  return [...roots.values()];
}

/**
 * Collapses single-child *directory* chains into one node (`public` + `.well-known` -> a node named
 * `public/.well-known`), then recurses into the remaining children. Returns a fresh node so the
 * caller's forest isn't mutated.
 */
function collapse(node: TreeNode): TreeNode {
  let current = node;
  while (!current.isFile && current.children.size === 1) {
    const only = [...current.children.values()][0];
    // A single *file* child is not a directory chain — keep the directory expanded above it.
    if (only === undefined || only.isFile) break;
    current = {
      name: `${current.name}/${only.name}`,
      isFile: false,
      children: only.children,
    };
  }
  const collapsedChildren = new Map<string, TreeNode>();
  for (const child of current.children.values()) {
    const collapsed = collapse(child);
    collapsedChildren.set(collapsed.name, collapsed);
  }
  return { ...current, children: collapsedChildren };
}

/** Alphabetical by segment name, directories and files interleaved (rule 1 above). */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => a.name.localeCompare(b.name));
}

/** A file renders as `name — annotation` (or bare `name`); a directory as `name/`. */
function label(node: TreeNode): string {
  if (node.isFile) {
    return node.annotation !== undefined ? `${node.name} — ${node.annotation}` : node.name;
  }
  return `${node.name}/`;
}

/**
 * Renders a node's children with the `├ └ │` connectors (matching route-tree.ts), each indent one
 * 4-column step: `│   ` under a non-last sibling so the vertical stem continues, `    ` under the
 * last so it doesn't.
 */
function renderChildren(nodes: TreeNode[], prefix: string, lines: string[]): void {
  const sorted = sortNodes(nodes);
  sorted.forEach((node, index) => {
    const isLast = index === sorted.length - 1;
    lines.push(`${prefix}${isLast ? '└' : '├'} ${label(node)}`);
    if (!node.isFile) {
      renderChildren([...node.children.values()], `${prefix}${isLast ? '    ' : '│   '}`, lines);
    }
  });
}

/**
 * Renders `entries` as a nested file tree. Top-level roots (`public/`, `app/`, a bare file like
 * `ax-manifest.ts`) render as sibling roots each at column zero with no connector, so several roots
 * in one list stay unambiguous — a root is always visually distinct from a child (which carries a
 * `├`/`└`). Returns plain lines with no prefix; empty input yields an empty array.
 */
export function renderFileTree(entries: FileTreeEntry[]): string[] {
  const roots = sortNodes(buildForest(entries).map(collapse));
  const lines: string[] = [];
  for (const root of roots) {
    lines.push(label(root));
    if (!root.isFile) renderChildren([...root.children.values()], '', lines);
  }
  return lines;
}
