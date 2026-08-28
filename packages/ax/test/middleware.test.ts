import { describe, expect, it, vi } from 'vitest';

import type { NextFetchEvent, NextRequest } from 'next/server';

import type { ServingManifestData } from '../src/manifest.js';
import { axMatcher, renderWayfinding, withAx } from '../src/middleware/index.js';
import type { AxDetectionInfo, AxServingManifest } from '../src/middleware/index.js';

// Compile-time contract check: what the build-side writer produces must stay readable by the
// runtime middleware. If either shape drifts, this stops compiling.
const writerIsReadableByRuntime = (data: ServingManifestData): AxServingManifest => data;
void writerIsReadableByRuntime;

const GPTBOT_UA = 'Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const manifest: AxServingManifest = {
  basePath: '',
  routes: ['/', '/docs', '/pricing', '/private'],
  markdownTwins: {
    '/': '/index.md',
    '/docs': '/docs.md',
    // A twin shadowing a gated route — must never be served (the gate wins over the twin).
    '/private': '/private.md',
  },
  gatedPaths: ['/private', '/api/private/mcp'],
  artifacts: {
    aiCatalog: '/.well-known/ai-catalog.json',
    llmsTxt: '/llms.txt',
    authMd: '/auth.md',
  },
};

function agentRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new Request(url, {
    headers: { 'user-agent': GPTBOT_UA, ...headers },
  }) as unknown as NextRequest;
}

function browserRequest(url: string): NextRequest {
  return new Request(url, {
    headers: {
      'user-agent': CHROME_UA,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    },
  }) as unknown as NextRequest;
}

function fetchEvent(): NextFetchEvent & { waitUntil: ReturnType<typeof vi.fn> } {
  return { waitUntil: vi.fn() } as unknown as NextFetchEvent & {
    waitUntil: ReturnType<typeof vi.fn>;
  };
}

async function run(
  request: NextRequest,
  options: Parameters<typeof withAx>[0] = { manifest },
  wrapped?: Parameters<typeof withAx>[1],
): Promise<Response | null | undefined | void> {
  return withAx(options, wrapped)(request, fetchEvent());
}

describe('withAx — fall-through (never negotiates for plain clients)', () => {
  it('hands a browser navigation to the wrapped middleware untouched', async () => {
    const inner = new Response(null, { headers: { 'x-inner': '1' } });
    const wrapped = vi.fn().mockReturnValue(inner);
    const request = browserRequest('https://site.example/docs');
    const event = fetchEvent();

    const response = await withAx({ manifest }, wrapped)(request, event);

    expect(wrapped).toHaveBeenCalledWith(request, event);
    expect(response).toBe(inner);
  });

  it('returns undefined (continue the chain) for a browser when nothing is wrapped', async () => {
    expect(await run(browserRequest('https://site.example/docs'))).toBeUndefined();
  });
});

describe('withAx — twin rewrites', () => {
  it('rewrites a detected agent to the manifest-listed twin, with both header invariants', async () => {
    const response = (await run(agentRequest('https://site.example/docs'))) as Response;

    expect(response.headers.get('x-middleware-rewrite')).toBe('https://site.example/docs.md');
    expect(response.headers.get('vary')).toBe('Accept');
    expect(response.headers.get('link')).toBe('<https://site.example/docs>; rel="canonical"');
  });

  it('negotiates on Accept: text/markdown alone — no agent required', async () => {
    const request = new Request('https://site.example/docs', {
      headers: { 'user-agent': CHROME_UA, accept: 'text/markdown' },
    }) as unknown as NextRequest;

    const response = (await run(request)) as Response;
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://site.example/docs.md');
    expect(response.headers.get('vary')).toBe('Accept');
  });

  it('serves the homepage twin for /', async () => {
    const response = (await run(agentRequest('https://site.example/'))) as Response;
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://site.example/index.md');
  });

  it('normalizes a trailing slash before the lookup', async () => {
    const response = (await run(agentRequest('https://site.example/docs/'))) as Response;
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://site.example/docs.md');
    expect(response.headers.get('link')).toBe('<https://site.example/docs>; rel="canonical"');
  });

  it('preserves the query string on the rewrite target', async () => {
    const response = (await run(agentRequest('https://site.example/docs?section=api'))) as Response;
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://site.example/docs.md?section=api',
    );
  });

  it('never rewrites off prototype properties of the twin map', async () => {
    const response = await run(agentRequest('https://site.example/constructor'));
    // '/constructor' is no route in the manifest → wayfinding, never a rewrite to a non-string.
    expect((response as Response).headers.get('x-middleware-rewrite')).toBeNull();
  });
});

describe('withAx — the manifest is the contract (no blind rewrites, no gated paths)', () => {
  it('never rewrites a gated path, even when a twin shadows it', async () => {
    const wrapped = vi.fn().mockReturnValue(undefined);
    const response = await withAx({ manifest }, wrapped)(
      agentRequest('https://site.example/private'),
      fetchEvent(),
    );

    expect(wrapped).toHaveBeenCalledOnce();
    expect(response).toBeUndefined();
  });

  it('falls through for a real route with no twin — its HTML is the only truth', async () => {
    expect(await run(agentRequest('https://site.example/pricing'))).toBeUndefined();
  });

  it('never claims "not found" under a dynamic-route prefix — the app answers those', async () => {
    const withDynamic: AxServingManifest = { ...manifest, dynamicRoutePrefixes: ['/blog'] };
    // /blog/hello may be a real page only the request can resolve → fall through, not wayfinding.
    expect(
      await run(agentRequest('https://site.example/blog/hello'), { manifest: withDynamic }),
    ).toBeUndefined();
    expect(
      await run(agentRequest('https://site.example/blog'), { manifest: withDynamic }),
    ).toBeUndefined();
    // Prefix matching is segment-wise: /blogroll is not under /blog.
    const blogroll = (await run(agentRequest('https://site.example/blogroll'), {
      manifest: withDynamic,
    })) as Response;
    expect(blogroll.status).toBe(200);
    expect(blogroll.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });

  it('a root-level dynamic route disables wayfinding entirely', async () => {
    const rootDynamic: AxServingManifest = { ...manifest, dynamicRoutePrefixes: ['/'] };
    expect(
      await run(agentRequest('https://site.example/anything-at-all'), { manifest: rootDynamic }),
    ).toBeUndefined();
  });
});

describe('withAx — wayfinding for unknown URLs', () => {
  it('answers a detected agent with 200 + text/markdown rendered from the manifest', async () => {
    const response = (await run(agentRequest('https://site.example/nope'))) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('vary')).toBe('Accept');
    // No canonical Link: a URL that exists on no route has no canonical HTML page.
    expect(response.headers.get('link')).toBeNull();

    const body = await response.text();
    expect(body).toMatch(/^# \/nope — not found/);
    expect(body).toContain('[/.well-known/ai-catalog.json](/.well-known/ai-catalog.json)');
    expect(body).toContain('[/llms.txt](/llms.txt)');
    expect(body).toContain('[/docs](/docs) — markdown: [/docs.md](/docs.md)');
    expect(body).toContain('[/pricing](/pricing)');
  });

  it('renders born-passing markdown: an H1, links, no code fences, well under the size ceiling', () => {
    const body = renderWayfinding(manifest, '/missing');
    expect(body.startsWith('# ')).toBe(true);
    expect(body).toMatch(/\[[^\]]+\]\([^)]+\)/);
    expect(body.match(/^(`{3,}|~{3,})/gm) ?? []).toHaveLength(0);
    expect(body.length).toBeLessThan(100_000);
  });

  it('caps the route list and says so', () => {
    const big: AxServingManifest = {
      ...manifest,
      routes: Array.from({ length: 60 }, (_, index) => `/page-${index}`),
    };
    const body = renderWayfinding(big, '/missing');
    expect(body).toContain('/page-49');
    expect(body).not.toContain('/page-50');
    expect(body).toContain('…and 10 more');
  });
});

describe('withAx — armored onDetection', () => {
  it('reports the twin branch with the detection method', async () => {
    const seen: AxDetectionInfo[] = [];
    await run(agentRequest('https://site.example/docs'), {
      manifest,
      onDetection: (info) => {
        seen.push(info);
      },
    });

    expect(seen).toEqual([
      { path: '/docs', method: 'ua-match', userAgent: GPTBOT_UA, served: 'twin' },
    ]);
  });

  it('reports accept-header negotiation as its own method', async () => {
    const seen: AxDetectionInfo[] = [];
    const request = new Request('https://site.example/nope', {
      headers: { 'user-agent': CHROME_UA, accept: 'text/markdown' },
    }) as unknown as NextRequest;
    await run(request, { manifest, onDetection: (info) => void seen.push(info) });

    expect(seen).toEqual([
      { path: '/nope', method: 'accept-header', userAgent: CHROME_UA, served: 'wayfinding' },
    ]);
  });

  it('swallows a synchronous throw — telemetry never breaks serving', async () => {
    const response = (await run(agentRequest('https://site.example/docs'), {
      manifest,
      onDetection: () => {
        throw new Error('telemetry exploded');
      },
    })) as Response;

    expect(response.headers.get('x-middleware-rewrite')).toBe('https://site.example/docs.md');
  });

  it('hands an async callback to event.waitUntil with its rejection absorbed', async () => {
    const event = fetchEvent();
    const response = withAx({
      manifest,
      onDetection: () => Promise.reject(new Error('async telemetry exploded')),
    })(agentRequest('https://site.example/docs'), event) as Response;

    expect(response.headers.get('x-middleware-rewrite')).toBe('https://site.example/docs.md');
    expect(event.waitUntil).toHaveBeenCalledOnce();
    // The armored promise settles without rejecting — an unhandled rejection here fails the test.
    await expect(event.waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });
});

describe('withAx — canonical URL hardening', () => {
  it('derives the canonical from X-Forwarded-Proto/-Host, rebuilt from parsed components', async () => {
    const response = (await run(
      agentRequest('http://10.0.0.5:3000/docs', {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'site.example',
      }),
    )) as Response;

    expect(response.headers.get('link')).toBe('<https://site.example/docs>; rel="canonical"');
  });

  it('takes the first value of a comma-joined forwarded header', async () => {
    const response = (await run(
      agentRequest('http://10.0.0.5:3000/docs', {
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'site.example, internal.lan',
      }),
    )) as Response;

    expect(response.headers.get('link')).toBe('<https://site.example/docs>; rel="canonical"');
  });

  it.each([
    ['an unparseable host', { 'x-forwarded-host': 'not a host' }],
    ['a host smuggling a path', { 'x-forwarded-host': 'evil.example/phish' }],
    ['a host smuggling credentials', { 'x-forwarded-host': 'user:pass@evil.example' }],
    ['a non-http(s) forwarded proto', { 'x-forwarded-proto': 'javascript' }],
  ])('omits the Link header entirely on %s — never reflect raw input', async (_name, headers) => {
    const response = (await run(agentRequest('https://site.example/docs', headers))) as Response;

    expect(response.headers.get('link')).toBeNull();
    // Serving is unaffected: the rewrite and Vary still happen.
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://site.example/docs.md');
    expect(response.headers.get('vary')).toBe('Accept');
  });

  it('lets the canonicalUrl override win, and lets it omit with null', async () => {
    const withOverride = (await run(agentRequest('https://site.example/docs'), {
      manifest,
      canonicalUrl: (pathname) => `https://public.example${pathname}`,
    })) as Response;
    expect(withOverride.headers.get('link')).toBe('<https://public.example/docs>; rel="canonical"');

    const omitted = (await run(agentRequest('https://site.example/docs'), {
      manifest,
      canonicalUrl: () => null,
    })) as Response;
    expect(omitted.headers.get('link')).toBeNull();
  });
});

describe('axMatcher', () => {
  it('excludes Next internals, api, dotted paths, and probe paths; matches page routes', () => {
    // Next matchers are path-to-regexp source; for this shape a direct RegExp is equivalent.
    const pattern = new RegExp(`^${axMatcher[0]}$`);
    const matches = (path: string): boolean => pattern.test(path);

    expect(matches('/docs')).toBe(true);
    expect(matches('/')).toBe(true);
    expect(matches('/_next/static/chunk.js')).toBe(false);
    expect(matches('/api/private/mcp')).toBe(false);
    expect(matches('/docs.md')).toBe(false);
    expect(matches('/robots.txt')).toBe(false);
    expect(matches('/favicon.ico')).toBe(false);
  });
});

describe('discovery-artifact protection (protectDiscovery)', () => {
  const blockingGate = vi.fn(() => new Response('denied', { status: 403 }));

  function gateManifest(): AxServingManifest {
    return {
      ...manifest,
      artifacts: {
        ...manifest.artifacts,
        mcpServerCard: '/.well-known/mcp/server-card.json',
        mcpServerCards: ['/.well-known/mcp/server-card/api-mcp.json'],
        openapi: '/openapi.json',
      },
    };
  }

  it('serves every published artifact past a blocking wrapped middleware, for any client', async () => {
    blockingGate.mockClear();
    const wrapped = withAx({ manifest: gateManifest() }, blockingGate);
    for (const path of [
      '/.well-known/ai-catalog.json',
      '/.well-known/mcp/server-card.json',
      '/.well-known/mcp/server-card/api-mcp.json',
      '/llms.txt',
      '/auth.md',
      '/openapi.json',
      '/docs.md', // a twin's own path — direct fetches must not be gateable either
    ]) {
      // A scripty UA that typical bot gates block — and a plain browser both pass through.
      const scripty = new Request(`https://site.test${path}`, {
        headers: { 'user-agent': 'Go-http-client/1.1' },
      }) as unknown as NextRequest;
      expect(await wrapped(scripty, fetchEvent())).toBeUndefined();
      expect(
        await wrapped(browserRequest(`https://site.test${path}`), fetchEvent()),
      ).toBeUndefined();
    }
    expect(blockingGate).not.toHaveBeenCalled();
  });

  it('still hands ordinary page requests to the wrapped middleware', async () => {
    blockingGate.mockClear();
    const wrapped = withAx({ manifest: gateManifest() }, blockingGate);
    const response = await wrapped(browserRequest('https://site.test/pricing'), fetchEvent());
    expect(blockingGate).toHaveBeenCalledTimes(1);
    expect((response as Response).status).toBe(403);
  });

  it('protectDiscovery: false restores the old behavior (artifacts reach the gate)', async () => {
    blockingGate.mockClear();
    const wrapped = withAx({ manifest: gateManifest(), protectDiscovery: false }, blockingGate);
    const response = await wrapped(browserRequest('https://site.test/llms.txt'), fetchEvent());
    expect(blockingGate).toHaveBeenCalledTimes(1);
    expect((response as Response).status).toBe(403);
  });

  it('never protects gated paths or plain routes — only the published artifacts', async () => {
    blockingGate.mockClear();
    const wrapped = withAx({ manifest: gateManifest() }, blockingGate);
    await wrapped(browserRequest('https://site.test/private'), fetchEvent());
    await wrapped(browserRequest('https://site.test/'), fetchEvent());
    expect(blockingGate).toHaveBeenCalledTimes(2);
  });
});
