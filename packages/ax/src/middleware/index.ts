// The `@ora-ai/ax/middleware` runtime entry: content negotiation for AI agents, driven entirely by
// the build-generated serving manifest. Detected agents (and any client sending
// `Accept: text/markdown`) receive the markdown ax generated — the twin of the page they asked
// for, or a wayfinding body when the URL matches no route — with the response headers a negotiated
// markdown response must carry. Everything else falls through untouched.
//
// Division of labor: the build step generates and knows; the runtime negotiates. A middleware
// alone cannot know the route table, which twins exist, or which surfaces are gated — so this one
// refuses to guess: it only ever rewrites to a twin the manifest lists, and never touches a path
// the manifest marks gated. No blind rewrites, ever.
//
// This entry is Web-API-only with zero runtime dependencies (Edge-safe): no Node built-ins, none
// of the CLI's dependencies, and `next` only as type-only imports — the rewrite/fall-through
// contract is expressed through the `x-middleware-rewrite` response header (what
// `NextResponse.rewrite` itself sets) and a plain `undefined` return (continue the chain), so
// nothing from `next/server` is imported at runtime.

import type { NextFetchEvent, NextRequest } from 'next/server';

import { applyMarkdownHeaders } from '../markdown-headers.js';
import { acceptsMarkdown, detectAgent } from './detection.js';
import type { AgentDetection, AgentDetectionMethod } from './detection.js';
import type { AxServingManifest } from './manifest-shape.js';
import { renderWayfinding } from './wayfinding.js';

export { acceptsMarkdown, detectAgent, isBrowserDocumentNavigation } from './detection.js';
export type { AgentDetection, AgentDetectionMethod } from './detection.js';
export type { AxServingManifest } from './manifest-shape.js';
export { renderWayfinding } from './wayfinding.js';

/** How a negotiated request was identified — the cascade layers plus explicit Accept negotiation. */
export type AxNegotiationMethod = AgentDetectionMethod | 'accept-header';

/** What `onDetection` receives for every request this middleware answered with markdown. */
export interface AxDetectionInfo {
  /** The requested pathname (normalized, basePath included). */
  path: string;
  method: AxNegotiationMethod;
  userAgent: string | null;
  /** Which branch answered: a twin rewrite, or the wayfinding body for an unknown URL. */
  served: 'twin' | 'wayfinding';
}

/**
 * The middleware function shape this module wraps and returns. Structurally identical to Next's
 * `NextMiddleware`, declared here so the only coupling to `next` stays type-level.
 */
export type AxMiddleware = (
  request: NextRequest,
  event: NextFetchEvent,
) => Response | null | undefined | void | Promise<Response | null | undefined | void>;

export interface WithAxOptions {
  /** The generated serving manifest — `import { axManifest } from './ax-manifest'`. */
  manifest: AxServingManifest;
  /**
   * Fire-and-forget telemetry, armored: a synchronous throw is swallowed, a returned promise is
   * handed to `event.waitUntil()` with its rejection absorbed. Telemetry can never break serving.
   */
  onDetection?: (info: AxDetectionInfo) => void | Promise<void>;
  /**
   * Overrides the canonical (HTML) URL declared on negotiated responses. Return `null` to omit the
   * `Link: rel="canonical"` header. Default: derived from `X-Forwarded-Proto`/`X-Forwarded-Host`/
   * `Host`, round-tripped through the URL parser (unparseable → header omitted, so a hostile
   * `Host` value never reaches a response header).
   */
  canonicalUrl?: (pathname: string, request: NextRequest) => string | URL | null | undefined;
}

/**
 * The recommended `middleware.ts` matcher: skip Next internals, API routes (never markdown-
 * negotiated — auth answers live there), any path with a file extension (static assets, and the
 * `.md` twins themselves, which Next serves directly), and well-known probe paths. Next.js only
 * accepts a statically analyzable `config.matcher`, so paste this value as a literal — referencing
 * the import from `config` will not survive Next's static analysis.
 */
export const axMatcher = ['/((?!_next|api|.*\\..*|favicon|robots|health|status).*)'] as const;

/**
 * Wraps (or stands in for) a Next.js middleware with manifest-driven markdown negotiation.
 *
 * Per request, in order:
 *   1. Not a detected agent and no markdown `Accept` → the wrapped middleware answers (or the
 *      chain just continues).
 *   2. The manifest marks the path gated → fall through untouched. The app's own 401/403 is the
 *      honest answer; this middleware never fakes or masks auth. Checked before twins on purpose:
 *      a stray twin shadowing a gated route must lose to the gate.
 *   3. The manifest lists a markdown twin → rewrite to it, with `Vary: Accept` + the canonical
 *      Link pointing at the HTML URL.
 *   4. The path is a real route with no twin → fall through; its HTML is the only truthful
 *      representation, and inventing a markdown one is the emission side's refusal too.
 *   5. The path matches no route → 200 + `text/markdown` wayfinding body rendered from the
 *      manifest. Agents discard 404 bodies, so a dead end gets directions instead; plain clients
 *      never reach this branch and keep the app's honest 404.
 */
export function withAx(options: WithAxOptions, middleware?: AxMiddleware): AxMiddleware {
  const { manifest } = options;

  return (request, event) => {
    const url = new URL(request.url);
    const pathname = normalizePathname(url.pathname);

    const detection = detectAgent(request.headers);
    if (!detection.detected && !acceptsMarkdown(request.headers)) {
      return middleware ? middleware(request, event) : undefined;
    }

    if (manifest.gatedPaths.includes(pathname)) {
      return middleware ? middleware(request, event) : undefined;
    }

    const twin = Object.prototype.hasOwnProperty.call(manifest.markdownTwins, pathname)
      ? manifest.markdownTwins[pathname]
      : undefined;
    if (typeof twin === 'string') {
      reportDetection(options, event, detectionInfo(request, pathname, detection, 'twin'));
      const target = new URL(url);
      target.pathname = twin;
      // What `NextResponse.rewrite(target)` sets — built directly so `next` stays a type-only peer.
      const response = new Response(null, {
        headers: { 'x-middleware-rewrite': target.toString() },
      });
      const canonicalUrl = resolveCanonicalUrl(options, pathname, request, url);
      applyMarkdownHeaders(
        response.headers,
        canonicalUrl !== undefined ? { canonicalUrl } : undefined,
      );
      return response;
    }

    if (manifest.routes.includes(pathname)) {
      return middleware ? middleware(request, event) : undefined;
    }

    // Under a dynamic-route prefix, whether the URL is a real page is only knowable at request
    // time — claiming "not found" for a live blog post would be a lie, so those misses stay the
    // app's to answer (its agent-aware 404 covers a genuine miss).
    if ((manifest.dynamicRoutePrefixes ?? []).some((prefix) => coveredByPrefix(pathname, prefix))) {
      return middleware ? middleware(request, event) : undefined;
    }

    reportDetection(options, event, detectionInfo(request, pathname, detection, 'wayfinding'));
    const response = new Response(renderWayfinding(manifest, pathname), {
      status: 200,
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    });
    // Vary: Accept only — a URL that exists on no route has no canonical HTML page to attribute.
    applyMarkdownHeaders(response.headers);
    return response;
  };
}

/** Trailing-slash-insensitive lookup key: the manifest records routes without a trailing slash. */
function normalizePathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** Whether `pathname` is the prefix itself or a path below it (segment-wise, never substring). */
function coveredByPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return pathname.startsWith(withSlash);
}

function detectionInfo(
  request: NextRequest,
  pathname: string,
  detection: AgentDetection,
  served: AxDetectionInfo['served'],
): AxDetectionInfo {
  return {
    path: pathname,
    method: detection.detected ? detection.method : 'accept-header',
    userAgent: request.headers.get('user-agent'),
    served,
  };
}

/** Armored `onDetection` dispatch: sync throws swallowed, promises to `event.waitUntil()`. */
function reportDetection(
  options: WithAxOptions,
  event: NextFetchEvent | undefined,
  info: AxDetectionInfo,
): void {
  if (options.onDetection === undefined) return;
  try {
    const result = options.onDetection(info);
    if (result instanceof Object && typeof (result as Promise<void>).then === 'function') {
      const settled = Promise.resolve(result).then(
        () => undefined,
        () => undefined,
      );
      event?.waitUntil(settled);
    }
  } catch {
    // Telemetry never breaks serving.
  }
}

/**
 * The canonical (HTML) URL a twin rewrite declares. The override wins (`null` → omit); the default
 * derives scheme and authority from `X-Forwarded-Proto` / `X-Forwarded-Host` / `Host` so proxy
 * setups attribute to the public origin — but only after a round-trip through the URL parser,
 * rebuilding from parsed components. Unparseable or non-http(s) input omits the header entirely:
 * hostile header values must never be reflected into a response header.
 */
function resolveCanonicalUrl(
  options: WithAxOptions,
  pathname: string,
  request: NextRequest,
  url: URL,
): string | URL | undefined {
  if (options.canonicalUrl !== undefined) {
    return options.canonicalUrl(pathname, request) ?? undefined;
  }

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const scheme = (forwardedProto?.split(',')[0]?.trim() ?? url.protocol.slice(0, -1)).toLowerCase();
  if (!/^https?$/.test(scheme)) return undefined;

  const authority =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host') ??
    url.host;
  try {
    const parsed = new URL(`${scheme}://${authority}`);
    if (parsed.hostname === '' || parsed.username !== '' || parsed.pathname !== '/') {
      return undefined;
    }
    return `${parsed.origin}${pathname}`;
  } catch {
    return undefined;
  }
}
