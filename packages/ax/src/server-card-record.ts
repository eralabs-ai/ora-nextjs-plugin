import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';
import { SERVER_CARD_DIR_OUTPUT_PATH, SERVER_CARD_OUTPUT_PATH } from './write.js';

/**
 * The gating decision a previously written server card records: which server it describes and
 * whether it requires auth. The committed cards *are* ax's persistence layer for MCP gating — the
 * user's public/gated answer (from `ax init` or a build's review gate) lands in each card's
 * `authentication` block, so the next build reads the cards back to know each surface was already
 * reviewed instead of asking again. The root card doubles as the record of which server is
 * primary (owns the root well-known path): its `serverUrl` names the chosen mount.
 */
export interface ServerCardRecord {
  serverUrl: string;
  authRequired: boolean;
}

/** Every gating decision the committed server cards record. */
export interface ServerCardRecords {
  /** The root card's record — also the primary-server decision. */
  root?: ServerCardRecord;
  /** Named per-server card records (multi-mount hosts), root's duplicate included. */
  named: ServerCardRecord[];
}

/** The shape of the fields this reader cares about; everything else in the card is ignored. */
interface RecordedCardShape {
  serverUrl?: unknown;
  authentication?: { required?: unknown };
}

// The 'route' emission target wraps the card JSON in a generated route handler whose payload is a
// single `const body = "<JSON-escaped string>";` line (see write.ts `routeHandlerSource`). This
// matches that one literal so the record survives either emission target.
const ROUTE_BODY_RE = /^const body = (".*");$/m;

/**
 * Reads every previously written MCP server card — the root
 * `public/.well-known/mcp/server-card.json`, the named `server-card/<name>.json` slots, and the
 * `'route'` emission target's generated handlers for both — and returns the gating decisions they
 * record. An unreadable card yields no record and is treated as "never reviewed" (the build
 * re-asks or warns), never as a silent "public".
 */
export function readServerCardRecords(cwd: string): ServerCardRecords {
  const appDir = findAppDir(cwd);

  const root =
    parseRecord(readStaticCard(join(cwd, SERVER_CARD_OUTPUT_PATH))) ??
    (appDir !== undefined
      ? parseRecord(readRouteCard(join(appDir, '.well-known', 'mcp', 'server-card.json')))
      : undefined);

  const named: ServerCardRecord[] = [];
  const staticDir = join(cwd, SERVER_CARD_DIR_OUTPUT_PATH);
  if (existsSync(staticDir)) {
    for (const name of listJsonEntries(staticDir)) {
      const record = parseRecord(readStaticCard(join(staticDir, name)));
      if (record !== undefined) named.push(record);
    }
  }
  const routeDir =
    appDir !== undefined ? join(appDir, '.well-known', 'mcp', 'server-card') : undefined;
  if (routeDir !== undefined && existsSync(routeDir)) {
    for (const name of listJsonEntries(routeDir)) {
      const record = parseRecord(readRouteCard(join(routeDir, name)));
      if (record !== undefined) named.push(record);
    }
  }

  return { ...(root !== undefined ? { root } : {}), named };
}

/** Every record, flattened — for callers that only match mounts against decisions. */
export function allServerCardRecords(records: ServerCardRecords): ServerCardRecord[] {
  return [...(records.root !== undefined ? [records.root] : []), ...records.named];
}

function listJsonEntries(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

function readStaticCard(path: string): string | undefined {
  return existsSync(path) ? safeRead(path) : undefined;
}

/** Extracts the JSON body from a `'route'` target's handler dir (`<name>.json/route.{ts,js}`). */
function readRouteCard(handlerDir: string): string | undefined {
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

function parseRecord(body: string | undefined): ServerCardRecord | undefined {
  if (body === undefined) return undefined;
  try {
    const card = JSON.parse(body) as RecordedCardShape;
    if (typeof card.serverUrl !== 'string' || card.serverUrl === '') return undefined;
    return { serverUrl: card.serverUrl, authRequired: card.authentication?.required === true };
  } catch {
    return undefined;
  }
}
