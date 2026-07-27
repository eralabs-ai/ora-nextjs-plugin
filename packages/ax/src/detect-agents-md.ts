import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { findAppDir } from './app-dir.js';
import { ROUTE_FILE_NAMES } from './walk-files.js';

export interface DetectAgentsMdOptions {
  cwd: string;
  /** Emits an advisory recommendation (not a warning — nothing is broken). */
  recommend: (message: string) => void;
}

export interface DetectAgentsMdResult {
  found: boolean;
  source?: string;
}

/**
 * Detect-and-recommend for `agents.md` — an agent-guidance file with
 * explicit *when-to-use / when-NOT-to-use* sections. The plugin only detects a served one
 * (`public/agents.md` or an App Router `agents.md/route.*`) and, when absent, recommends adding it.
 * It never guesses the *content*: authoring that guidance from the repo is judgment work owned by
 * the companion skill, not this deterministic build step.
 */
export function detectAgentsMd(options: DetectAgentsMdOptions): DetectAgentsMdResult {
  const source = findAgentsMdSource(options.cwd);

  if (source) {
    options.recommend(
      `agents.md detected (${relativeSource(options.cwd, source)}) — confirm it has clear ` +
        'when-to-use / when-NOT-to-use guidance for agents.',
    );
    return { found: true, source };
  }

  options.recommend(
    'No agents.md found — consider adding one (public/agents.md) with when-to-use / when-NOT-to-use ' +
      "guidance for agents. ora-catalog won't write its content for you; the " +
      'companion skill can help author it from your repo.',
  );
  return { found: false };
}

/** Finds a static `public/agents.md` or an App Router `agents.md/route.*`. */
function findAgentsMdSource(cwd: string): string | undefined {
  const staticFile = join(cwd, 'public', 'agents.md');
  if (existsSync(staticFile)) return staticFile;

  const appDir = findAppDir(cwd);
  if (!appDir) return undefined;
  const routeDir = join(appDir, 'agents.md');
  if (!existsSync(routeDir)) return undefined;
  let names: string[];
  try {
    names = readdirSync(routeDir);
  } catch {
    return undefined;
  }
  const match = names.find((name) => ROUTE_FILE_NAMES.has(name));
  return match ? join(routeDir, match) : undefined;
}

function relativeSource(cwd: string, source: string): string {
  return source.startsWith(cwd) ? source.slice(cwd.length).replace(/^[/\\]/, '') : source;
}
