import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The runtime entry's hard packaging constraint, asserted at the source level: everything
// reachable from src/middleware/index.ts must be Web-API-only (Edge-safe) with zero runtime
// dependencies. The CLI's dependencies (ajv, jiti, turndown, domino), Node built-ins, and a
// runtime `next` import must never enter this graph — `next` is a type-only peer. Source-level
// (rather than dist-level) so the check runs without a build; the fixture's real `next build`
// proves the same property against the bundled output.

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const ENTRY = join(srcDir, 'middleware', 'index.ts');

/** Every `from '...'` specifier in a module, split into runtime and type-only imports. */
function importSpecifiers(source: string): { runtime: string[]; typeOnly: string[] } {
  const runtime: string[] = [];
  const typeOnly: string[] = [];
  // Handles `import ... from`, `export ... from`, and multi-line brace lists. The clause between
  // the keyword and `from` is restricted to specifier-clause characters so an `export interface`
  // followed by prose containing "from '...'" can never be mistaken for an import statement.
  const statements =
    source.match(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[\w\s{},*]*?from\s*['"][^'"]+['"]/g) ??
    [];
  for (const statement of statements) {
    const specifier = statement.match(/from\s*['"]([^'"]+)['"]/)?.[1];
    if (specifier === undefined) continue;
    (/\b(?:import|export)\s+type\b/.test(statement) ? typeOnly : runtime).push(specifier);
  }
  // Side-effect imports (`import 'x'`) have no `from` — the graph must not contain any at all.
  expect(source.match(/(?:^|\n)\s*import\s*['"][^'"]+['"]/g) ?? []).toEqual([]);
  return { runtime, typeOnly };
}

/** Follows relative runtime imports from the entry, returning every reachable source file. */
function runtimeClosure(entry: string): Map<string, { runtime: string[]; typeOnly: string[] }> {
  const seen = new Map<string, { runtime: string[]; typeOnly: string[] }>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const specifiers = importSpecifiers(readFileSync(file, 'utf8'));
    seen.set(file, specifiers);
    for (const specifier of specifiers.runtime) {
      if (!specifier.startsWith('.')) continue;
      queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
    }
  }
  return seen;
}

describe('the middleware entry import graph', () => {
  const closure = runtimeClosure(ENTRY);

  it('reaches only the expected dependency-free modules', () => {
    const files = [...closure.keys()].map((file) => file.slice(srcDir.length)).sort();
    // manifest-shape.ts is absent by design: it is imported type-only, so it never reaches the
    // runtime graph at all.
    expect(files).toEqual([
      'agent-ua.ts',
      'markdown-headers.ts',
      'middleware/detection.ts',
      'middleware/index.ts',
      'middleware/wayfinding.ts',
    ]);
  });

  it('has no runtime import of any package or Node built-in — relative imports only', () => {
    for (const [file, { runtime }] of closure) {
      const bare = runtime.filter((specifier) => !specifier.startsWith('.'));
      expect(bare, `${file} imports at runtime: ${bare.join(', ')}`).toEqual([]);
    }
  });

  it('keeps next type-only, and types come from nowhere else but next', () => {
    const bareTypeOnly = [...closure.values()]
      .flatMap(({ typeOnly }) => typeOnly)
      .filter((specifier) => !specifier.startsWith('.'));
    expect(new Set(bareTypeOnly).size <= 1).toBe(true);
    for (const specifier of bareTypeOnly) expect(specifier).toBe('next/server');
  });
});
