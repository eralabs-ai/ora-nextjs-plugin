import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { buildArtifactUrl, buildUrn } from './site-url.js';
import type { CatalogEntry } from './types.js';

export interface DetectOpenApiOptions {
  cwd: string;
  siteUrl: string | undefined;
  basePath: string;
  warn: (message: string) => void;
}

interface OpenApiInfoShape {
  title?: unknown;
  description?: unknown;
}

interface OpenApiDocShape {
  openapi?: unknown;
  info?: OpenApiInfoShape;
}

/**
 * Detect-and-reference for a static `public/openapi.json` (PLAN.md Phase 3.1). Never synthesizes
 * or regenerates a doc from route handlers — it only references one the app already produces, and
 * only once it's confirmed to actually parse as an OpenAPI 3.x document. A missing, unparseable,
 * or unrecognized doc yields no entry at all (never a guess, never a build failure).
 */
export function detectOpenApi(options: DetectOpenApiOptions): CatalogEntry | undefined {
  const filePath = join(options.cwd, 'public', 'openapi.json');
  if (!existsSync(filePath)) return undefined;

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    options.warn(
      `Found public/openapi.json but couldn't read it (${(err as Error).message}) — skipping.`,
    );
    return undefined;
  }

  let doc: OpenApiDocShape;
  try {
    doc = JSON.parse(raw) as OpenApiDocShape;
  } catch {
    options.warn(
      'Found public/openapi.json but it is not valid JSON — skipping (this never fails the build).',
    );
    return undefined;
  }

  const version = extractOpenApiVersion(doc);
  if (version === undefined) {
    options.warn(
      'Found public/openapi.json but it does not look like an OpenAPI 3.x document (missing or ' +
        'unrecognized "openapi" field) — skipping.',
    );
    return undefined;
  }

  if (!options.siteUrl) {
    options.warn(
      'Found a valid public/openapi.json but no site URL is known — set "siteUrl" in ard.config, ' +
        'or deploy on Vercel, to include it in the catalog.',
    );
    return undefined;
  }

  const title = typeof doc.info?.title === 'string' ? doc.info.title : undefined;
  const description = typeof doc.info?.description === 'string' ? doc.info.description : undefined;

  return {
    identifier: buildUrn(options.siteUrl, 'openapi'),
    type: `application/vnd.oai.openapi+json;version=${version}`,
    displayName: title ?? 'OpenAPI',
    url: buildArtifactUrl(options.siteUrl, options.basePath, '/openapi.json'),
    updatedAt: statSync(filePath).mtime.toISOString(),
    ...(description !== undefined ? { description } : {}),
  };
}

/** Returns "3.x" for a recognized OpenAPI 3.x `openapi` field, or undefined otherwise. */
function extractOpenApiVersion(doc: OpenApiDocShape): string | undefined {
  if (typeof doc.openapi !== 'string') return undefined;
  const match = /^3\.(\d+)(?:\.\d+)?$/.exec(doc.openapi.trim());
  return match ? `3.${match[1]}` : undefined;
}
