import { describe, expect, it } from 'vitest';

import {
  acceptsMarkdown,
  detectAgent,
  isBrowserDocumentNavigation,
} from '../src/middleware/detection.js';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

// Real UA strings (not just the corpus fragments), so the substring matching is exercised the way
// production traffic exercises it.
const GPTBOT_UA =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
const CLAUDEBOT_UA =
  'Mozilla/5.0 AppleWebKit/537.36 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';
const CURSOR_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/0.40.0 Chrome/124.0.0.0 Electron/30.0.0 Safari/537.36';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('detectAgent — layer 1, UA substring', () => {
  it.each([
    ['GPTBot', GPTBOT_UA],
    ['ClaudeBot', CLAUDEBOT_UA],
    ['Perplexity', 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/bot)'],
  ])('detects %s from its user-agent', (_name, userAgent) => {
    expect(detectAgent(headers({ 'user-agent': userAgent }))).toEqual({
      detected: true,
      method: 'ua-match',
    });
  });

  it("detects Cursor's server-side fetcher (no sec-fetch headers)", () => {
    expect(detectAgent(headers({ 'user-agent': CURSOR_UA }))).toEqual({
      detected: true,
      method: 'ua-match',
    });
  });

  it("never matches a browser document navigation — Cursor's embedded browser gets HTML", () => {
    // The embedded-browser guard: the UA says "cursor", but a human is looking at the viewport
    // (sec-fetch-mode: navigate + sec-fetch-dest: document only come from a real browser).
    const result = detectAgent(
      headers({
        'user-agent': CURSOR_UA,
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
      }),
    );
    expect(result).toEqual({ detected: false, method: null });
  });

  it('still matches an agent UA on a non-navigation request that sends sec-fetch headers', () => {
    const result = detectAgent(
      headers({ 'user-agent': GPTBOT_UA, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }),
    );
    expect(result).toEqual({ detected: true, method: 'ua-match' });
  });
});

describe('detectAgent — the cloaking firewall (traditional bots)', () => {
  it.each([
    ['Googlebot', GOOGLEBOT_UA],
    ['Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    ['Twitterbot', 'Twitterbot/1.0'],
    ['UptimeRobot', 'Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
  ])('never detects %s, even without sec-fetch headers', (_name, userAgent) => {
    // No sec-fetch-mode + a bot-like UA would satisfy the heuristic layer — the traditional-bot
    // veto is what keeps these on user HTML.
    expect(detectAgent(headers({ 'user-agent': userAgent }))).toEqual({
      detected: false,
      method: null,
    });
  });
});

describe('detectAgent — layer 2, Signature-Agent', () => {
  it('detects a known Signature-Agent domain regardless of the UA', () => {
    const result = detectAgent(
      headers({
        'user-agent': CHROME_UA,
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'signature-agent': '"https://chatgpt.com"',
      }),
    );
    expect(result).toEqual({ detected: true, method: 'signature-agent' });
  });

  it('ignores an unknown Signature-Agent domain', () => {
    const result = detectAgent(
      headers({ 'user-agent': CHROME_UA, 'signature-agent': '"https://unknown.example"' }),
    );
    expect(result.detected).toBe(false);
  });
});

describe('detectAgent — layer 3, heuristic', () => {
  it('detects a bot-like UA that sends no sec-fetch-mode at all', () => {
    const result = detectAgent(headers({ 'user-agent': 'AcmeResearchCrawler/2.0' }));
    expect(result).toEqual({ detected: true, method: 'heuristic' });
  });

  it('does not fire when sec-fetch-mode is present (real browsers always send one)', () => {
    const result = detectAgent(
      headers({ 'user-agent': 'AcmeResearchCrawler/2.0', 'sec-fetch-mode': 'no-cors' }),
    );
    expect(result.detected).toBe(false);
  });

  it('does not fire on a non-bot-like UA (curl stays a plain client)', () => {
    expect(detectAgent(headers({ 'user-agent': 'curl/8.6.0' })).detected).toBe(false);
  });

  it('does not fire with no user-agent at all', () => {
    expect(detectAgent(headers({})).detected).toBe(false);
  });
});

describe('isBrowserDocumentNavigation', () => {
  it('requires both sec-fetch-mode: navigate and sec-fetch-dest: document', () => {
    expect(
      isBrowserDocumentNavigation(
        headers({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }),
      ),
    ).toBe(true);
    expect(isBrowserDocumentNavigation(headers({ 'sec-fetch-mode': 'navigate' }))).toBe(false);
    expect(isBrowserDocumentNavigation(headers({ 'sec-fetch-dest': 'document' }))).toBe(false);
    expect(isBrowserDocumentNavigation(headers({}))).toBe(false);
  });
});

describe('acceptsMarkdown', () => {
  it('accepts text/markdown and the legacy text/x-markdown, any casing, any position', () => {
    expect(acceptsMarkdown(headers({ accept: 'text/markdown' }))).toBe(true);
    expect(acceptsMarkdown(headers({ accept: 'Text/Markdown;q=0.9, text/html' }))).toBe(true);
    expect(acceptsMarkdown(headers({ accept: 'text/x-markdown' }))).toBe(true);
  });

  it('rejects browser Accept headers and absent Accept', () => {
    expect(acceptsMarkdown(headers({ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }))).toBe(
      false,
    );
    expect(acceptsMarkdown(headers({}))).toBe(false);
  });

  it('is independent of detection — an explicit Accept from a search crawler still negotiates', () => {
    // Honest content negotiation is not cloaking: the same URL varies by Accept, with Vary set.
    const requestHeaders = headers({ 'user-agent': GOOGLEBOT_UA, accept: 'text/markdown' });
    expect(detectAgent(requestHeaders).detected).toBe(false);
    expect(acceptsMarkdown(requestHeaders)).toBe(true);
  });
});
