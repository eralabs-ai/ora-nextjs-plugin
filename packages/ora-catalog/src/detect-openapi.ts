import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { buildArtifactUrl, buildUrn } from './site-url.js';
import type { CatalogEntry } from './types.js';

export interface DetectOpenApiOptions {
  cwd: string;
  siteUrl: string | undefined;
  basePath: string;
  warn: (message: string) => void;
  /**
   * Advisory recommendation channel (not a warning — nothing is broken). Optional so the detector
   * can still run standalone; `generateCatalog` always supplies it. Emits a "recommend adding an
   * OpenAPI doc" nudge when none is present, and a "declare securitySchemes" nudge when a doc exists
   * but declares no auth.
   */
  recommend?: (message: string) => void;
}

interface OpenApiInfoShape {
  title?: unknown;
  description?: unknown;
}

interface OpenApiComponentsShape {
  securitySchemes?: unknown;
}

interface OpenApiDocShape {
  openapi?: unknown;
  info?: OpenApiInfoShape;
  components?: OpenApiComponentsShape;
}

// An OpenAPI doc is the single highest-density artifact for agent discovery: it lets agents
// understand and call an API's routes, request/response schemas, and auth requirements without
// guessing. The plugin never builds one — converting route handlers or Zod schemas to OpenAPI is a
// library's job — so when none is present it names the idiomatic Next.js path instead.
const OPENAPI_ABSENT_RECOMMENDATION =
  'No OpenAPI doc found (public/openapi.json) — this is the highest-value artifact for agent ' +
  'discovery, since it lets agents understand and call your API without guessing at routes or ' +
  'schemas. ora-catalog never generates one; produce it the idiomatic Next.js way and commit it to ' +
  'public/openapi.json: with Zod, use zod-openapi or @asteasolutions/zod-to-openapi; otherwise ' +
  'next-swagger-doc or next-openapi-gen.';

/**
 * Detect-and-reference for a static `public/openapi.json`. Never synthesizes
 * or regenerates a doc from route handlers — it only references one the app already produces, and
 * only once it's confirmed to actually parse as an OpenAPI 3.x document. A missing, unparseable,
 * or unrecognized doc yields no entry at all (never a guess, never a build failure). When the doc is
 * absent it recommends adding one; when present but declaring no `components.securitySchemes` it
 * nudges toward declaring one so agents know how to authenticate.
 */
export function detectOpenApi(options: DetectOpenApiOptions): CatalogEntry | undefined {
  const recommend = options.recommend ?? (() => {});
  const filePath = join(options.cwd, 'public', 'openapi.json');
  if (!existsSync(filePath)) {
    recommend(OPENAPI_ABSENT_RECOMMENDATION);
    return undefined;
  }

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

  // A doc with no declared security schemes tells agents nothing about how to authenticate — nudge
  // toward declaring `components.securitySchemes` so an agent (or a catalog entry describing this
  // API) knows how to authenticate.
  if (!hasSecuritySchemes(doc)) {
    recommend(
      'public/openapi.json declares no components.securitySchemes — if your API requires auth, add ' +
        'the scheme(s) there so agents know how to authenticate. Omit it only if the API is ' +
        'genuinely open.',
    );
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

/** Whether the doc declares at least one entry under `components.securitySchemes`. */
function hasSecuritySchemes(doc: OpenApiDocShape): boolean {
  const schemes = doc.components?.securitySchemes;
  return (
    typeof schemes === 'object' &&
    schemes !== null &&
    Object.keys(schemes as Record<string, unknown>).length > 0
  );
}

/** Returns "3.x" for a recognized OpenAPI 3.x `openapi` field, or undefined otherwise. */
function extractOpenApiVersion(doc: OpenApiDocShape): string | undefined {
  if (typeof doc.openapi !== 'string') return undefined;
  const match = /^3\.(\d+)(?:\.\d+)?$/.exec(doc.openapi.trim());
  return match ? `3.${match[1]}` : undefined;
}
