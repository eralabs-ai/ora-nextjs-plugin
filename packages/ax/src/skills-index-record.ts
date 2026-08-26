import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';

/**
 * The previously published agent-skills index is ax's own persistence record for hand-edit
 * detection — there is no sidecar state file. Each build reads the index it wrote last time (the
 * `name` + `digest` of every skill it served) so it can tell an untouched published copy from one a
 * human edited after ax published it, and which skills it published before but no longer does. The
 * committed index *is* the record: the same idiom the MCP server cards use (see
 * server-card-record.ts), which keeps the persisted state and the served artifact from ever drifting
 * apart.
 */
export interface SkillRecord {
  name: string;
  digest: string;
}

/** The subset of the index shape this reader cares about; everything else is ignored. */
interface RecordedIndexShape {
  skills?: unknown;
}

interface RecordedSkillShape {
  name?: unknown;
  digest?: unknown;
}

// The 'route' emission target wraps the index JSON in a generated route handler whose payload is a
// single `const body = "<JSON-escaped string>";` line (see write.ts `routeHandlerSource`). This
// matches that one literal so the record survives either emission target — the same approach
// server-card-record.ts uses for cards.
const ROUTE_BODY_RE = /^const body = (".*");$/m;

/**
 * Reads the previously published agent-skills index — the static
 * `public/.well-known/agent-skills/index.json`, or the `'route'` emission target's generated
 * handler at `app/.well-known/agent-skills/index.json/route.{ts,js}` — and returns the `name` +
 * `digest` of every skill it recorded. Malformed JSON, a missing file, or entries missing a name or
 * digest are tolerated (bad entries are skipped, everything else returns `[]`): a broken or absent
 * record just means "nothing was published before", which re-publishes rather than throwing.
 */
export function readSkillsIndexRecord(cwd: string): SkillRecord[] {
  const staticPath = join(cwd, 'public', '.well-known', 'agent-skills', 'index.json');
  const body = readStatic(staticPath) ?? readRouteBody(cwd);
  return parseIndex(body);
}

function readStatic(path: string): string | undefined {
  return existsSync(path) ? safeRead(path) : undefined;
}

/** Extracts the JSON body from the `'route'` target's `index.json/route.{ts,js}` handler. */
function readRouteBody(cwd: string): string | undefined {
  const appDir = findAppDir(cwd);
  if (appDir === undefined) return undefined;
  const handlerDir = join(appDir, '.well-known', 'agent-skills', 'index.json');
  for (const routeFile of ['route.ts', 'route.js']) {
    const routePath = join(handlerDir, routeFile);
    if (!existsSync(routePath)) continue;
    const source = safeRead(routePath);
    if (source === undefined) return undefined;
    const literal = ROUTE_BODY_RE.exec(source)?.[1];
    if (literal === undefined) return undefined;
    try {
      return JSON.parse(literal) as string;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function safeRead(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function parseIndex(body: string | undefined): SkillRecord[] {
  if (body === undefined) return [];
  let parsed: RecordedIndexShape;
  try {
    parsed = JSON.parse(body) as RecordedIndexShape;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.skills)) return [];

  const records: SkillRecord[] = [];
  for (const entry of parsed.skills as RecordedSkillShape[]) {
    if (entry === null || typeof entry !== 'object') continue;
    if (typeof entry.name !== 'string' || entry.name === '') continue;
    if (typeof entry.digest !== 'string' || entry.digest === '') continue;
    records.push({ name: entry.name, digest: entry.digest });
  }
  return records;
}
