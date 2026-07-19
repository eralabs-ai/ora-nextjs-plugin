import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AiCatalog } from './types.js';
import { formatCatalogErrors, validateCatalogArd } from './validate.js';

/** Where the Phase 1 static emission target lands, relative to the project root. */
export const CATALOG_OUTPUT_PATH = join('public', '.well-known', 'ai-catalog.json');

export type WriteCatalogResult = { ok: true; path: string } | { ok: false; errors: string };

/**
 * Validates a catalog against the strict official ARD schema and, only if valid, writes it to
 * `public/.well-known/ai-catalog.json` under `cwd`. Never writes an invalid catalog — this is the
 * hard-fail gate the plan calls for: a bad catalog is worse than none, so it must never reach a
 * real deployment. The strict (not permissive) schema gates here because this is *emitted* output:
 * it must survive the official conformance tool, not merely count as a catalog.
 *
 * The write itself is atomic (write to a temp file, then rename into place) so a crash or
 * concurrent build never leaves a half-written, unparseable catalog on disk.
 */
export function writeCatalog(cwd: string, catalog: AiCatalog): WriteCatalogResult {
  const result = validateCatalogArd(catalog);
  if (!result.valid) {
    return { ok: false, errors: formatCatalogErrors(result.errors) };
  }

  const outPath = join(cwd, CATALOG_OUTPUT_PATH);
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;

  mkdirSync(dirname(outPath), { recursive: true });
  try {
    writeFileSync(tmpPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, outPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }

  return { ok: true, path: outPath };
}
