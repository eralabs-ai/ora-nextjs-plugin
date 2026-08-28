import { withAx } from '@ora-ai/ax/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { axManifest } from './ax-manifest';

// Bot policy: traditional search crawlers AND reputable AI agents are explicitly
// allowed to reach the site; only anonymous scripting/scraping tooling is challenged.
const ALLOWED_CRAWLERS = [
  /googlebot/i,
  /bingbot/i,
  /duckduckbot/i,
  /applebot/i,
  // Reputable AI crawlers — allowed so agents can discover and read the site.
  /gptbot/i,
  /chatgpt-user/i,
  /oai-searchbot/i,
  /claudebot/i,
  /claude-web/i,
  /claude-user/i,
  /anthropic/i,
  /perplexitybot/i,
  /perplexity-user/i,
  /google-extended/i,
  /meta-externalagent/i,
  /amazonbot/i,
  /cohere/i,
  /deepseekbot/i,
  /ccbot/i,
  /ora-agent/i,
];

const BLOCKED_AGENTS = [
  /curl/i,
  /wget/i,
  /python-requests/i,
  /python-httpx/i,
  /aiohttp/i,
  /go-http-client/i,
  /node-fetch/i,
  /scrapy/i,
];

function deniedPage(rayId: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Access denied</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b1526;color:#e8edf5;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:520px;padding:48px;text-align:center">
<div style="font-size:44px;margin-bottom:16px">&#9992;&#65039;</div>
<div style="font-size:22px;font-weight:600;margin-bottom:12px">Access denied</div>
<div style="font-size:15px;line-height:1.6;color:#9aa7ba">Automated traffic has been detected from your connection. To protect our customers, access to ora-air has been blocked.<br><br>Error 1020 &middot; Ray ID: ${rayId}</div>
</div>
</body>
</html>`;
}

function botGate(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') ?? '';

  if (
    !userAgent ||
    (!ALLOWED_CRAWLERS.some((p) => p.test(userAgent)) &&
      BLOCKED_AGENTS.some((p) => p.test(userAgent)))
  ) {
    const rayId = Math.random().toString(16).slice(2, 18);
    return new NextResponse(deniedPage(rayId), {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return NextResponse.next();
}

// withAx's optional second argument: the app's own middleware runs for every request ax's
// negotiation doesn't claim — the composition a real app with an existing middleware uses.
export default withAx({ manifest: axManifest }, botGate);

export const config = {
  matcher: ['/((?!_next|api|.*\\..*|favicon|robots|health|status).*)'],
};
