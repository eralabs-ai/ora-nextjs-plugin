import { describe, expect, it } from 'vitest';

import {
  AI_AGENT_UA_PATTERNS,
  BOT_LIKE_REGEX,
  REPUTABLE_AI_CRAWLERS,
  SIGNATURE_AGENT_DOMAINS,
  TRADITIONAL_BOT_PATTERNS,
  TRAINING_ONLY_CRAWLERS,
  UA_CORPUS_REVIEWED,
} from '../src/agent-ua.js';

describe('agent-ua corpus', () => {
  it('records a review date so staleness is visible', () => {
    expect(UA_CORPUS_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps every layer-1 UA pattern lowercase (matched via a lowercased UA)', () => {
    for (const pattern of AI_AGENT_UA_PATTERNS) {
      expect(pattern).toBe(pattern.toLowerCase());
      expect(pattern.trim()).toBe(pattern);
      expect(pattern.length).toBeGreaterThan(0);
    }
  });

  it('covers the vendor families the detection cascade relies on', () => {
    for (const pattern of ['claudebot', 'gptbot', 'oai-searchbot', 'perplexitybot', 'bytespider']) {
      expect(AI_AGENT_UA_PATTERNS).toContain(pattern);
    }
  });

  it('tracks the ChatGPT Signature-Agent domain', () => {
    expect(SIGNATURE_AGENT_DOMAINS).toContain('chatgpt.com');
  });

  it('keeps search engines and monitors in the traditional-bot firewall', () => {
    for (const pattern of ['googlebot', 'bingbot', 'twitterbot', 'uptimerobot']) {
      expect(TRADITIONAL_BOT_PATTERNS).toContain(pattern);
    }
    // These keep receiving user HTML, so they must never be listed as AI agents.
    for (const pattern of TRADITIONAL_BOT_PATTERNS) {
      expect(AI_AGENT_UA_PATTERNS).not.toContain(pattern);
    }
  });

  it('matches real AI crawler UAs with the heuristic regex but not a plain browser', () => {
    expect(BOT_LIKE_REGEX.test('Mozilla/5.0 (compatible; GPTBot/1.2)')).toBe(true);
    expect(BOT_LIKE_REGEX.test('OAI-SearchBot/1.0')).toBe(true);
    expect(BOT_LIKE_REGEX.test('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120')).toBe(
      false,
    );
  });

  it('splits the robots policy: reputable crawlers get Allow, training-only crawlers do not', () => {
    expect(REPUTABLE_AI_CRAWLERS).toContain('GPTBot');
    expect(TRAINING_ONLY_CRAWLERS).toEqual(['CCBot', 'Bytespider']);
    // The two lists never overlap — a crawler is either allowed or shown as a block-it-yourself example.
    const reputable = new Set(REPUTABLE_AI_CRAWLERS.map((n) => n.toLowerCase()));
    for (const training of TRAINING_ONLY_CRAWLERS) {
      expect(reputable.has(training.toLowerCase())).toBe(false);
    }
  });
});
