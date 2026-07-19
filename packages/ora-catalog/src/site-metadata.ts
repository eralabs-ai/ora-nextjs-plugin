import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

/** Unambiguous, cheap-to-derive facts about the site. No guessing, no code scanning. */
export interface SiteMetadata {
  displayName: string;
  description?: string;
  /** Best-effort production domain, from a hosting provider's build-time env vars. */
  domain?: string;
}

interface PackageJsonShape {
  name?: unknown;
  description?: unknown;
}

/** Strips an npm scope (`@scope/name` -> `name`) so it reads as a display name. */
function unscopedName(name: string): string {
  const slash = name.indexOf('/');
  return name.startsWith('@') && slash !== -1 ? name.slice(slash + 1) : name;
}

/**
 * Reads `package.json` for site-level facts. Never throws: a missing or malformed
 * `package.json` is not this plugin's problem to fail the build over — fall back to the
 * project directory name so the catalog still gets a `displayName`.
 */
export function readSiteMetadata(cwd: string): SiteMetadata {
  const fallback: SiteMetadata = { displayName: basename(resolve(cwd)) };

  let pkg: PackageJsonShape;
  try {
    const raw = readFileSync(resolve(cwd, 'package.json'), 'utf8');
    pkg = JSON.parse(raw) as PackageJsonShape;
  } catch {
    return { ...fallback, domain: readVercelDomain() };
  }

  const displayName =
    typeof pkg.name === 'string' && pkg.name.trim() !== ''
      ? unscopedName(pkg.name.trim())
      : fallback.displayName;
  const description =
    typeof pkg.description === 'string' && pkg.description.trim() !== ''
      ? pkg.description.trim()
      : undefined;

  return { displayName, description, domain: readVercelDomain() };
}

/**
 * Best-effort production domain from Vercel's build-time env vars — unambiguous, provider-supplied
 * truth, not a guess. `VERCEL_PROJECT_PRODUCTION_URL` is the stable production domain; falls back to
 * the per-deployment `VERCEL_URL`. Absent outside Vercel (or in Phase 1's other hosts) — that's fine,
 * `domain` stays undefined and the catalog omits `host.identifier`.
 */
function readVercelDomain(): string | undefined {
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return domain && domain.trim() !== '' ? domain.trim() : undefined;
}
