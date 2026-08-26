import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { findAppDir } from './app-dir.js';
import {
  planSkillsPublish,
  type SkillCandidate,
  type SkillsPublishPlan,
} from './publish-skills.js';
import { buildArtifactUrl, buildUrn } from './site-url.js';
import type { CatalogEntry } from './types.js';
import { ROUTE_FILE_NAMES } from './walk-files.js';

/**
 * Detect-and-reference for agent skills. Scans the repo for `skills/<name>/SKILL.md` (and, for
 * `ax init` display only, `.claude/skills/<name>/SKILL.md`), and — when `publishSkills` selected a
 * set — hands them to the pure planner and references the discovery index in the catalog. Publishing
 * repo content to the public site is an exposure decision, so nothing is published unless the config
 * opts in; auto-discovery *never* reaches into `.claude/skills/` (that directory holds skills for
 * local agent sessions, not necessarily ones meant for public discovery). Pure: this reads the
 * filesystem and plans, but writes nothing — applying the plan is the write layer's job, after the
 * review gate.
 */
export interface DetectSkillsOptions {
  cwd: string;
  /** `ax.config` `publishSkills`, resolved. */
  publishSkills: boolean | string[];
  siteUrl?: string;
  basePath: string;
  warn: (message: string) => void;
  recommend: (message: string) => void;
}

export interface DetectSkillsResult {
  /** An agent-skills index is served (pre-existing) or will be published this run. */
  found: boolean;
  /** Relative path of the index that made `found` true. */
  source?: string;
  /** Every `skills/<name>/SKILL.md`, regardless of config (for `ax init`). */
  repoCandidates: SkillCandidate[];
  /** Every `.claude/skills/<name>/SKILL.md` (for `ax init` display only). */
  claudeCandidates: SkillCandidate[];
  /** The publish plan — only when `publishSkills` selected a non-empty set. */
  plan?: SkillsPublishPlan;
  /** Catalog entry for the index — only when `found` and `siteUrl` is known. */
  entry?: CatalogEntry;
}

/** Where the published/served discovery index lives, relative to the project root. */
const INDEX_SEGMENTS = ['.well-known', 'agent-skills', 'index.json'];

const SKILLS_UNSERVED_RECOMMENDATION = (count: number): string =>
  `Found ${count} skill${count === 1 ? '' : 's'} under skills/ but nothing serves them — set ` +
  '`publishSkills: true` in ax.config to publish them with a discovery index agents can find, or ' +
  'list specific skill directories to publish a subset.';

/**
 * Detects served agent skills and plans a publish when opted in. `found` is true when an index is
 * already served *or* one will be published this run; `plan` is present only when a non-empty set
 * was selected; `entry` only when `found` and a site URL is known. When skills exist in the repo but
 * nothing publishes them, recommends turning `publishSkills` on rather than acting unbidden.
 */
export function detectSkills(options: DetectSkillsOptions): DetectSkillsResult {
  const { cwd, publishSkills, siteUrl, basePath, warn, recommend } = options;

  const repoCandidates = scanCandidates(cwd, ['skills']);
  const claudeCandidates = scanCandidates(cwd, ['.claude', 'skills']);

  const selected = selectCandidates(cwd, publishSkills, repoCandidates, warn);

  const result: DetectSkillsResult = {
    found: false,
    repoCandidates,
    claudeCandidates,
  };

  if (selected.length > 0) {
    result.plan = planSkillsPublish({ cwd, candidates: selected, warn });
    result.found = true;
    result.source = join('public', ...INDEX_SEGMENTS);
  } else {
    const existing = findServedIndex(cwd);
    if (existing !== undefined) {
      // Something already serves an index for content ax didn't write this run — reference it, but
      // don't recompute or plan anything over it.
      result.found = true;
      result.source = existing;
    } else if (repoCandidates.length > 0) {
      recommend(SKILLS_UNSERVED_RECOMMENDATION(repoCandidates.length));
    }
  }

  if (result.found && siteUrl !== undefined) {
    result.entry = {
      identifier: buildUrn(siteUrl, 'agent-skills'),
      type: 'application/agent-skills+json',
      displayName: 'Agent skills',
      description:
        'Agent Skills this site publishes for coding agents to discover and load — a discovery ' +
        'index (Agent Skills spec) linking each skill and its instructions.',
      url: buildArtifactUrl(siteUrl, basePath, '/.well-known/agent-skills/index.json'),
    };
  }

  return result;
}

/**
 * Resolves the selected candidate set from `publishSkills`. `true` selects every repo candidate
 * (never a `.claude/skills/` one — auto-discovery stays out of that directory). A `string[]` is
 * evaluated as explicit root-relative skill directory paths (the only way a `.claude/skills/` skill
 * gets published): each must contain a `SKILL.md`, or it's warned about and skipped. `false` selects
 * nothing.
 */
function selectCandidates(
  cwd: string,
  publishSkills: boolean | string[],
  repoCandidates: SkillCandidate[],
  warn: (message: string) => void,
): SkillCandidate[] {
  if (publishSkills === true) return repoCandidates;
  if (!Array.isArray(publishSkills)) return [];

  const selected: SkillCandidate[] = [];
  for (const entry of publishSkills) {
    const dirPath = normalizeRelative(entry);
    const skillMdPath = join(dirPath, 'SKILL.md');
    if (!isFile(join(cwd, skillMdPath))) {
      warn(`publishSkills lists ${entry} but ${entry}/SKILL.md does not exist — skipping.`);
      continue;
    }
    selected.push({ name: basename(dirPath), dirPath, skillMdPath });
  }
  return selected;
}

/**
 * Every immediate subdirectory of `<cwd>/<base>` that directly contains a `SKILL.md`, one level
 * deep, sorted by name. A skill is a directory with a `SKILL.md` in it; nothing deeper counts.
 */
function scanCandidates(cwd: string, baseSegments: string[]): SkillCandidate[] {
  const baseDir = join(cwd, ...baseSegments);
  let entries: string[];
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const candidates: SkillCandidate[] = [];
  for (const name of entries) {
    const skillMdPath = join(...baseSegments, name, 'SKILL.md');
    if (isFile(join(cwd, skillMdPath))) {
      candidates.push({ name, dirPath: join(...baseSegments, name), skillMdPath });
    }
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}

/** A pre-existing served index: static `public/...index.json` or the `'route'` handler form. */
function findServedIndex(cwd: string): string | undefined {
  const staticPath = join(cwd, 'public', ...INDEX_SEGMENTS);
  if (existsSync(staticPath)) return relative(cwd, staticPath);

  const appDir = findAppDir(cwd);
  if (appDir === undefined) return undefined;
  const handlerDir = join(appDir, ...INDEX_SEGMENTS);
  if (!existsSync(handlerDir)) return undefined;
  let names: string[];
  try {
    names = readdirSync(handlerDir);
  } catch {
    return undefined;
  }
  const match = names.find((name) => ROUTE_FILE_NAMES.has(name));
  return match ? relative(cwd, join(handlerDir, match)) : undefined;
}

/** Strips leading `./` and surrounding slashes so a config path resolves under `cwd`. */
function normalizeRelative(path: string): string {
  return path.replace(/^\.?[/\\]+/, '').replace(/[/\\]+$/, '');
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
