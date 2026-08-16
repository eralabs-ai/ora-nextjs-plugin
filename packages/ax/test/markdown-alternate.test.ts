import { describe, expect, it } from 'vitest';

import { buildMarkdownAlternateRecommendation } from '../src/markdown-alternate.js';

describe('buildMarkdownAlternateRecommendation', () => {
  it('emits nothing until a markdown twin exists', () => {
    expect(
      buildMarkdownAlternateRecommendation({
        siteUrl: 'https://example.com',
        basePath: '',
        twinPaths: [],
      }),
    ).toEqual([]);
  });

  it('recommends an absolute alternate link tag for a synthetic twin manifest', () => {
    const messages = buildMarkdownAlternateRecommendation({
      siteUrl: 'https://example.com',
      basePath: '',
      twinPaths: ['/docs.md', '/pricing.md'],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(
      '<link rel="alternate" type="text/markdown" href="https://example.com/docs.md" />',
    );
    // Printed for the developer to apply — never auto-inserted.
    expect(messages[0]).toContain('never edits');
  });

  it('respects basePath in the example href', () => {
    const [message] = buildMarkdownAlternateRecommendation({
      siteUrl: 'https://example.com',
      basePath: '/app',
      twinPaths: ['/docs.md'],
    });

    expect(message).toContain('href="https://example.com/app/docs.md"');
  });

  it('falls back to the served path when no site origin resolved', () => {
    const [message] = buildMarkdownAlternateRecommendation({
      siteUrl: undefined,
      basePath: '/app',
      twinPaths: ['/docs.md'],
    });

    expect(message).toContain('href="/app/docs.md"');
  });
});
