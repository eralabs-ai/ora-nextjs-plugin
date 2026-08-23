// The markdown body a detected agent receives for a URL that matches no route in the serving
// manifest. Agents discard 404 response bodies (most clients surface only the status), so the one
// honest, useful answer to a dead-end request is a 200 with directions — real routes and the
// discovery artifacts that actually exist, straight from the build-generated manifest instead of a
// generic template. Plain clients never see this: the middleware only serves it to detected
// agents / markdown-Accept requesters, so browsers keep the app's honest 404.

import type { AxServingManifest } from './manifest-shape.js';

/**
 * Cap on routes listed in the body — a navigation aid, not a sitemap replacement (the same cap the
 * agent-aware 404 page's data module uses). Also keeps the body far under the 100k-char truncation
 * ceiling agents are subject to.
 */
const MAX_ROUTES = 50;

/** What each discovery artifact is for, phrased for the agent reading the body. */
const ARTIFACT_PURPOSES: ReadonlyArray<{
  key: keyof AxServingManifest['artifacts'];
  purpose: string;
}> = [
  { key: 'aiCatalog', purpose: 'machine-readable catalog of everything this site offers agents' },
  { key: 'llmsTxt', purpose: 'what this site is for and its key pages, in plain language' },
  { key: 'authMd', purpose: 'how to obtain access to the gated surfaces' },
  { key: 'openapi', purpose: 'the REST API, as an OpenAPI document' },
  { key: 'mcpServerCard', purpose: 'the MCP server card (connection + capabilities)' },
];

/**
 * Renders the wayfinding markdown for `pathname`. Born passing the generated-markdown audit
 * criteria by construction: opens with an H1, contains markdown links, uses no code fences (an
 * even count of zero), and stays orders of magnitude under the 100k-char ceiling via `MAX_ROUTES`.
 */
export function renderWayfinding(manifest: AxServingManifest, pathname: string): string {
  const lines: string[] = [
    `# ${pathname} — not found`,
    '',
    'This URL does not exist on this site. It may have moved, or it may never have existed —',
    'requesting it again will keep returning this response. Do not retry; start from the links',
    'below instead.',
    '',
  ];

  const artifactLines: string[] = [];
  for (const { key, purpose } of ARTIFACT_PURPOSES) {
    const path = manifest.artifacts[key];
    if (typeof path === 'string') artifactLines.push(`- [${path}](${path}) — ${purpose}`);
  }
  for (const card of manifest.artifacts.mcpServerCards ?? []) {
    artifactLines.push(`- [${card}](${card}) — MCP server card`);
  }
  if (artifactLines.length > 0) {
    lines.push('## Start here', '', ...artifactLines, '');
  }

  if (manifest.routes.length > 0) {
    lines.push('## Pages that do exist', '');
    for (const route of manifest.routes.slice(0, MAX_ROUTES)) {
      const twin = manifest.markdownTwins[route];
      lines.push(
        twin !== undefined
          ? `- [${route}](${route}) — markdown: [${twin}](${twin})`
          : `- [${route}](${route})`,
      );
    }
    if (manifest.routes.length > MAX_ROUTES) {
      lines.push(
        `- …and ${manifest.routes.length - MAX_ROUTES} more — see the discovery links above.`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
