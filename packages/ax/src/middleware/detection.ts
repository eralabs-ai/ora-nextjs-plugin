// Request-time AI-agent detection — the consumer of the agent-ua corpus. Web-API-only (a standard
// `Headers` object, no Node built-ins, no framework imports) so it runs unchanged in an Edge
// middleware.
//
// Posture: recall over precision, deliberately — mis-serving markdown to a misidentified client is
// low-harm and reversible (the client re-requests, or a human sees markdown once). That is the
// opposite of the emission-side posture (a published catalog claim is neither), and both are
// correct: the stakes differ by layer. Two guards are NOT subject to that posture and are
// non-optional:
//
//   1. Traditional search crawlers, social-preview unfurlers, and uptime probes must never be
//      treated as AI agents. Serving a search engine different content than browsers see at the
//      same URL is cloaking — a penalty-class offense — and a preview bot handed markdown renders
//      no card. The traditional-bot list vetoes every layer below, not just the heuristic.
//   2. A real browser document navigation must never match on UA substrings. Agent-embedded
//      browsers advertise their product in the UA (Cursor's embedded Chromium says "Cursor"), but
//      a human is looking at that viewport — it must get HTML. `sec-fetch-mode: navigate` +
//      `sec-fetch-dest: document` identifies it: browsers always send both (forbidden headers a
//      script can't remove), and non-browser HTTP clients send neither.

import {
  AI_AGENT_UA_PATTERNS,
  BOT_LIKE_REGEX,
  SIGNATURE_AGENT_DOMAINS,
  TRADITIONAL_BOT_PATTERNS,
} from '../agent-ua.js';

/** Which detection layer identified the agent — logged via `onDetection` so operators can see it. */
export type AgentDetectionMethod = 'ua-match' | 'signature-agent' | 'heuristic';

/** Discriminated detection result: `method` is only meaningful when `detected` is true. */
export type AgentDetection =
  { detected: true; method: AgentDetectionMethod } | { detected: false; method: null };

const NOT_DETECTED: AgentDetection = { detected: false, method: null };

/**
 * A human navigating a browser tab to a page: `sec-fetch-mode: navigate` + `sec-fetch-dest:
 * document`. Both are browser-controlled forbidden headers, so their joint presence is a reliable
 * "eyes on this response" signal — and their absence on a UA-matched request means the agent's
 * *fetcher* (not its embedded browser) is asking.
 */
export function isBrowserDocumentNavigation(headers: Headers): boolean {
  return (
    headers.get('sec-fetch-mode') === 'navigate' && headers.get('sec-fetch-dest') === 'document'
  );
}

/**
 * The three-layer detection cascade over the agent-ua corpus:
 *
 *   1. UA substring — the request's user-agent contains a known AI-agent fragment, unless the
 *      request is a real browser document navigation (embedded-browser guard above).
 *   2. `Signature-Agent` header (RFC 9421 signed self-identification) names a known agent domain.
 *   3. Heuristic — no `sec-fetch-mode` at all (every real browser sends one; most HTTP libraries
 *      don't) plus a bot-like UA. The broadest layer, and the reason the posture note exists.
 *
 * The traditional-bot veto runs before all three: a UA naming a search/preview/uptime bot is never
 * detected, whatever the other layers would say.
 */
export function detectAgent(headers: Headers): AgentDetection {
  const userAgent = headers.get('user-agent')?.toLowerCase() ?? '';

  if (userAgent && TRADITIONAL_BOT_PATTERNS.some((pattern) => userAgent.includes(pattern))) {
    return NOT_DETECTED;
  }

  if (
    userAgent &&
    !isBrowserDocumentNavigation(headers) &&
    AI_AGENT_UA_PATTERNS.some((pattern) => userAgent.includes(pattern))
  ) {
    return { detected: true, method: 'ua-match' };
  }

  const signatureAgent = headers.get('signature-agent')?.toLowerCase();
  if (
    signatureAgent !== undefined &&
    SIGNATURE_AGENT_DOMAINS.some((domain) => signatureAgent.includes(domain))
  ) {
    return { detected: true, method: 'signature-agent' };
  }

  if (!headers.has('sec-fetch-mode') && userAgent && BOT_LIKE_REGEX.test(userAgent)) {
    return { detected: true, method: 'heuristic' };
  }

  return NOT_DETECTED;
}

/**
 * Whether the request explicitly negotiates for markdown (`Accept` names `text/markdown` or the
 * legacy `text/x-markdown`). Checked independently of agent detection: an Accept header is an
 * honest content-negotiation request from *any* client — answering it with a markdown variant plus
 * `Vary: Accept` is exactly what the header is for, so no cloaking guard applies here.
 */
export function acceptsMarkdown(headers: Headers): boolean {
  const accept = headers.get('accept')?.toLowerCase();
  if (accept === undefined) return false;
  return accept.includes('text/markdown') || accept.includes('text/x-markdown');
}
