import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';
import { SERVER_CARD_OUTPUT_PATH } from './write.js';

/**
 * The gating decision a previously written server card records: which server it describes and
 * whether it requires auth. The committed card *is* ax's persistence layer for MCP gating — the
 * user's public/gated answer (from `ax init` or a build's review gate) lands in the card's
 * `authentication` block, so the next build reads the card back to know the surface was already
 * reviewed instead of asking again.
 */
export interface ServerCardRecord {
  serverUrl: string;
  authRequired: boolean;
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
 * Reads the previously written MCP server card — static `public/.well-known/mcp/server-card.json`
 * first, then the `'route'` emission target's generated handler — and returns the gating decision
 * it records. Returns undefined when no card exists or it can't be parsed: an unreadable record is
 * treated as "never reviewed" (the build re-asks or warns), never as a silent "public".
 */
export function readServerCardRecord(cwd: string): ServerCardRecord | undefined {
  const staticPath = join(cwd, SERVER_CARD_OUTPUT_PATH);
  if (existsSync(staticPath)) {
    return parseRecord(safeRead(staticPath));
  }

  const appDir = findAppDir(cwd);
  if (appDir === undefined) return undefined;
  for (const routeFile of ['route.ts', 'route.js']) {
    const routePath = join(appDir, '.well-known', 'mcp', 'server-card.json', routeFile);
    if (!existsSync(routePath)) continue;
    const source = safeRead(routePath);
    if (source === undefined) return undefined;
    const literal = ROUTE_BODY_RE.exec(source)?.[1];
    if (literal === undefined) return undefined;
    try {
      return parseRecord(JSON.parse(literal) as string);
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
