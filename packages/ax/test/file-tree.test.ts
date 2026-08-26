import { describe, expect, it } from 'vitest';

import { type FileTreeEntry, renderFileTree } from '../src/file-tree.js';

// Unit coverage for the pure tree renderer: no filesystem, just entries in and lines out. Each test
// targets one documented rule from file-tree.ts's header comment.

describe('renderFileTree', () => {
  it('renders a single bare file with the single-root └ connector', () => {
    expect(renderFileTree([{ path: 'ax-manifest.ts' }])).toEqual(['└ ax-manifest.ts']);
  });

  it('empty input yields an empty array', () => {
    expect(renderFileTree([])).toEqual([]);
  });

  it('renders nested dirs with ┌ ├ └ │ connectors, multi-root and extra child indent', () => {
    const entries: FileTreeEntry[] = [
      { path: 'app/api/route.ts' },
      { path: 'app/page.tsx' },
      { path: 'public/index.md' },
    ];
    // Two roots: the first gets `┌` (route-tree convention), the last `└`. Each root's children
    // indent one extra step beyond the root's own connector column.
    expect(renderFileTree(entries)).toEqual([
      '┌ app/',
      '│   ├ api/',
      '│   │   └ route.ts',
      '│   └ page.tsx',
      '└ public/',
      '    └ index.md',
    ]);
  });

  it('collapses a chain of single-child directories into one segment', () => {
    const entries: FileTreeEntry[] = [{ path: 'public/.well-known/mcp/server-card.json' }];
    // A sole root gets `└` (not `┌`/`├`), and its child indents one extra step (four spaces).
    expect(renderFileTree(entries)).toEqual([
      '└ public/.well-known/mcp/',
      '    └ server-card.json',
    ]);
  });

  it('does not collapse a directory whose only child is a file', () => {
    // `a`'s only child is a *file*, not a directory — not a chain, so `a` stays expanded.
    const entries: FileTreeEntry[] = [{ path: 'a/b.txt' }];
    expect(renderFileTree(entries)).toEqual(['└ a/', '    └ b.txt']);
  });

  it('stops collapsing at the first directory with more than one child', () => {
    // `a` has a single directory child `b`, so the chain merges `a/b`. `b` itself has two file
    // children, so collapsing stops there — `b` stays expanded with both files under it.
    const entries: FileTreeEntry[] = [{ path: 'a/b/x.txt' }, { path: 'a/b/y.txt' }];
    expect(renderFileTree(entries)).toEqual(['└ a/b/', '    ├ x.txt', '    └ y.txt']);
  });

  it('renders a file annotation as "name — annotation"', () => {
    const entries: FileTreeEntry[] = [
      { path: 'ai-catalog.json', annotation: '2 KB (~500 tokens)' },
    ];
    expect(renderFileTree(entries)).toEqual(['└ ai-catalog.json — 2 KB (~500 tokens)']);
  });

  it('renders a bare file with no annotation with no em-dash', () => {
    expect(renderFileTree([{ path: 'ax-manifest.ts' }])).toEqual(['└ ax-manifest.ts']);
  });

  it('renders several roots (dirs and a bare file) with ┌ ├ └ connectors on every root', () => {
    const entries: FileTreeEntry[] = [
      { path: 'public/index.md' },
      { path: 'app/page.tsx' },
      { path: 'ax-manifest.ts' },
    ];
    // Roots sort alphabetically alongside each other (app, ax-manifest.ts, public); with three
    // roots the first gets `┌`, the middle `├`, the last `└` — matching route-tree.ts.
    expect(renderFileTree(entries)).toEqual([
      '┌ app/',
      '│   └ page.tsx',
      '├ ax-manifest.ts',
      '└ public/',
      '    └ index.md',
    ]);
  });

  it('sorts alphabetically with directories and files interleaved, not grouped by type', () => {
    // A "dirs first" implementation would order this a-dir, c-dir, b-file.txt, d-file.txt; the
    // documented rule is a single localeCompare on the name, so it must interleave.
    const entries: FileTreeEntry[] = [
      { path: 'root/a-dir/x.txt' },
      { path: 'root/b-file.txt' },
      { path: 'root/c-dir/y.txt' },
      { path: 'root/d-file.txt' },
    ];
    expect(renderFileTree(entries)).toEqual([
      '└ root/',
      '    ├ a-dir/',
      '    │   └ x.txt',
      '    ├ b-file.txt',
      '    ├ c-dir/',
      '    │   └ y.txt',
      '    └ d-file.txt',
    ]);
  });

  it('a directory name that is a prefix of a file name sorts first', () => {
    // `server-card` (a directory) is a prefix of `server-card.json` (a file) — plain localeCompare
    // puts the shorter, prefix string first.
    const entries: FileTreeEntry[] = [
      { path: 'mcp/server-card.json' },
      { path: 'mcp/server-card/api-mcp.json' },
    ];
    expect(renderFileTree(entries)).toEqual([
      '└ mcp/',
      '    ├ server-card/',
      '    │   └ api-mcp.json',
      '    └ server-card.json',
    ]);
  });
});
