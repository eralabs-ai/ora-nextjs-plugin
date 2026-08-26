import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readSkillsIndexRecord } from './skills-index-record.js';
import { jsonText } from './write.js';

/**
 * Pure planning of the agent-skills publish output (Agent Skills discovery spec v0.2.0). The
 * published copies under `public/.well-known/agent-skills/` and the discovery `index.json` are
 * *generated artifacts* — regenerated every build, never yours to hand-edit once written — so this
 * decides, without touching disk, exactly what a build should create, update, leave alone, or refuse
 * to overwrite because a human changed the published copy. The plan is the whole computation; the
 * write layer applies it after the review gate. Hand-edit detection reads the last index ax published (see
 * skills-index-record.ts) rather than any sidecar state.
 */

/** A skill to publish, already resolved by the detector. Paths are relative to `cwd`. */
export interface SkillCandidate {
  name: string;
  dirPath: string;
  skillMdPath: string;
}

export interface PlannedSkill {
  /** Frontmatter `name:` if present, else the skill's directory name. */
  name: string;
  /** The source SKILL.md, relative to `cwd` (e.g. `skills/getting-started/SKILL.md`). */
  sourcePath: string;
  /** Where the published copy lands, relative to `cwd`. */
  targetPath: string;
  /** The source SKILL.md content, copied verbatim. */
  content: string;
  description: string;
  /** `sha256:<hex>` of {@link content}. */
  digest: string;
  action: 'create' | 'update' | 'unchanged' | 'skip-hand-edited';
}

export interface SkillsPublishPlan {
  skills: PlannedSkill[];
  /** Published `<name>` dirs to remove at apply time (relative paths under `public/.well-known/agent-skills/`). */
  staleDirs: string[];
  /** Rendered index.json body (2-space indent + trailing newline, matching write.ts's JSON rendering). */
  indexJson: string;
  servedIndexPath: string;
}

export interface PlanSkillsPublishOptions {
  cwd: string;
  /** The selected set, already resolved by the detector. */
  candidates: SkillCandidate[];
  warn: (message: string) => void;
}

/** Filesystem segments of the published agent-skills directory, under the project root. */
const PUBLISH_DIR_SEGMENTS = ['public', '.well-known', 'agent-skills'];

/** The served (root-relative) URL of the discovery index — matches Ora's own live index. */
const SERVED_INDEX_PATH = '/.well-known/agent-skills/index.json';

/** The discovery spec version this planner emits. */
const DISCOVERY_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

/**
 * A directory name has to be a safe URL path segment — it becomes both a filesystem directory and a
 * `/.well-known/agent-skills/<name>/SKILL.md` URL segment. Anything else is rejected rather than
 * silently emitting a broken URL or escaping the publish directory.
 */
const SAFE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Plans this build's agent-skills publish — pure, no writes, so the CLI can show the plan at the
 * review gate before anything lands. For each candidate it decides an action against the last
 * published index (the record) and the copy currently on disk, and renders the discovery index that
 * describes what is actually served.
 */
export function planSkillsPublish(options: PlanSkillsPublishOptions): SkillsPublishPlan {
  const { cwd, candidates, warn } = options;
  const record = readSkillsIndexRecord(cwd);
  const recordDigestByName = new Map(record.map((entry) => [entry.name, entry.digest]));

  const skills: PlannedSkill[] = [];
  // The digest that describes what's *served* for a skill — the source digest for everything ax
  // manages, but the published copy's own digest for a hand-edited one (never lie about the digest).
  const servedDigestByName = new Map<string, string>();
  const plannedNames = new Set<string>();

  for (const candidate of candidates) {
    let content: string;
    try {
      content = readFileSync(join(cwd, candidate.skillMdPath), 'utf8');
    } catch (err) {
      warn(`Could not read ${candidate.skillMdPath} (${(err as Error).message}) — skipping.`);
      continue;
    }

    const { frontmatter, bodyStart } = parseFrontmatter(content);
    const name = frontmatter.name ?? candidate.name;

    if (!SAFE_NAME_RE.test(name)) {
      warn(
        `${candidate.skillMdPath} resolves to the skill name "${name}", which is not a valid URL ` +
          'path segment (allowed: letters, digits, and ._- , starting with a letter or digit) — ' +
          'skipping it. Rename the directory or set a valid `name:` in its frontmatter.',
      );
      continue;
    }

    const sourcePath = candidate.skillMdPath;
    const targetPath = join(...PUBLISH_DIR_SEGMENTS, name, 'SKILL.md');
    const sourceDigest = digestOf(content);

    let description = frontmatter.description;
    if (description === undefined || description === '') {
      description = firstParagraph(content, bodyStart) ?? '';
      warn(
        `${sourcePath} has no description frontmatter — using its first paragraph; add a ` +
          '`description:` for a better index entry.',
      );
    }

    const publishedContent = safeRead(join(cwd, ...PUBLISH_DIR_SEGMENTS, name, 'SKILL.md'));
    const recordDigest = recordDigestByName.get(name);

    let action: PlannedSkill['action'];
    let servedDigest = sourceDigest;
    if (recordDigest === undefined || publishedContent === undefined) {
      // No prior record for this name, or the published file is gone: re-publish. A missing file is
      // never treated as a hand-edit.
      action = 'create';
    } else {
      const publishedDigest = digestOf(publishedContent);
      if (publishedDigest !== recordDigest) {
        // The served copy no longer matches what ax recorded publishing — a human edited it. Keep
        // it in the plan (so the index still lists it), but refuse to overwrite, and describe the
        // digest that is *actually* served.
        action = 'skip-hand-edited';
        servedDigest = publishedDigest;
        warn(
          `${targetPath} was edited after ax published it — edit the source at ${sourcePath} ` +
            'instead; delete the published copy to let ax manage it again.',
        );
      } else if (sourceDigest !== recordDigest) {
        action = 'update';
      } else {
        action = 'unchanged';
      }
    }

    skills.push({
      name,
      sourcePath,
      targetPath,
      content,
      description,
      digest: sourceDigest,
      action,
    });
    servedDigestByName.set(name, servedDigest);
    plannedNames.add(name);
  }

  // Deterministic output: the index (and the plan) is sorted by name regardless of candidate order.
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const indexJson = jsonText({
    $schema: DISCOVERY_SCHEMA,
    skills: skills.map((skill) => ({
      name: skill.name,
      type: 'skill-md',
      description: skill.description,
      url: `/.well-known/agent-skills/${skill.name}/SKILL.md`,
      digest: servedDigestByName.get(skill.name) ?? skill.digest,
    })),
  });

  // A name in the record but not in this run's plan describes a skill ax published before and no
  // longer does — its published dir is stale and lies if left in place.
  const staleDirs = record
    .filter((entry) => !plannedNames.has(entry.name))
    .map((entry) => join(...PUBLISH_DIR_SEGMENTS, entry.name))
    .sort();

  return { skills, staleDirs, indexJson, servedIndexPath: SERVED_INDEX_PATH };
}

/** `sha256:<hex>` of a string — the digest format the discovery index records. */
function digestOf(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Reads a leading `---` frontmatter block for the two scalar keys this planner needs (`name`,
 * `description`), mirroring mdx-twin.ts's hand-rolled reader — no YAML dependency. Handles optional
 * single/double quotes and ignores anything it can't parse. Returns the parsed keys plus the line
 * index the body begins at (so the description fallback reads the body, not the frontmatter). An
 * unclosed block is treated as no frontmatter: the whole file is body.
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; bodyStart: number } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, bodyStart: 0 };

  const frontmatter: SkillFrontmatter = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') return { frontmatter, bodyStart: i + 1 };
    const match = /^(name|description):\s*(.+)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (match[1] === 'name') frontmatter.name = value;
      else frontmatter.description = value;
    }
  }
  return { frontmatter: {}, bodyStart: 0 };
}

/**
 * The first non-heading paragraph of the body — the description fallback when frontmatter declares
 * none. Skips leading headings and blank lines, then joins the first run of consecutive text lines.
 */
function firstParagraph(content: string, bodyStart: number): string | undefined {
  const buffer: string[] = [];
  for (const raw of content.split('\n').slice(bodyStart)) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (buffer.length > 0) break;
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (buffer.length > 0) break;
      continue;
    }
    buffer.push(trimmed);
  }
  const paragraph = buffer.join(' ').trim();
  return paragraph === '' ? undefined : paragraph;
}

function safeRead(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
