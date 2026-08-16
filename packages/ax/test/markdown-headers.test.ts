import { describe, expect, it } from 'vitest';

import { applyMarkdownHeaders, canonicalLinkHeader } from '../src/markdown-headers.js';

describe('applyMarkdownHeaders — Vary: Accept', () => {
  it('adds Vary: Accept to a response with no Vary', () => {
    const headers = applyMarkdownHeaders(new Headers());
    expect(headers.get('vary')).toBe('Accept');
  });

  it('appends Accept to a pre-existing Vary, preserving the existing token', () => {
    const headers = applyMarkdownHeaders(new Headers({ Vary: 'Accept-Encoding' }));
    // A token-level append: the existing Accept-Encoding must survive, and Accept must be added —
    // a naive substring check would see "accept" inside "accept-encoding" and add nothing.
    expect(headers.get('vary')).toBe('Accept-Encoding, Accept');
  });

  it('does not duplicate Accept when it is already present, whatever the casing', () => {
    const headers = applyMarkdownHeaders(new Headers({ Vary: 'Cookie, accept' }));
    expect(headers.get('vary')).toBe('Cookie, accept');
  });

  it('treats an existing Vary: * as already covering Accept', () => {
    const headers = applyMarkdownHeaders(new Headers({ Vary: '*' }));
    expect(headers.get('vary')).toBe('*');
  });

  it('does not mistake Accept-Encoding alone for Accept', () => {
    const headers = applyMarkdownHeaders(new Headers({ Vary: 'accept-encoding' }));
    expect(headers.get('vary')).toBe('accept-encoding, Accept');
  });
});

describe('applyMarkdownHeaders — canonical Link', () => {
  it('adds a canonical Link when a canonicalUrl is given and none is present', () => {
    const headers = applyMarkdownHeaders(new Headers(), {
      canonicalUrl: 'https://example.com/docs',
    });
    expect(headers.get('link')).toBe('<https://example.com/docs>; rel="canonical"');
  });

  it('accepts a URL object', () => {
    const headers = applyMarkdownHeaders(new Headers(), {
      canonicalUrl: new URL('https://example.com/docs'),
    });
    expect(headers.get('link')).toBe('<https://example.com/docs>; rel="canonical"');
  });

  it('adds no Link when no canonicalUrl is given', () => {
    const headers = applyMarkdownHeaders(new Headers());
    expect(headers.get('link')).toBeNull();
  });

  it('leaves an existing quoted canonical Link untouched', () => {
    const existing = '<https://example.com/original>; rel="canonical"';
    const headers = applyMarkdownHeaders(new Headers({ Link: existing }), {
      canonicalUrl: 'https://example.com/other',
    });
    expect(headers.get('link')).toBe(existing);
  });

  it('recognizes an existing bare (unquoted) rel=canonical', () => {
    const existing = '<https://example.com/original>; rel=canonical';
    const headers = applyMarkdownHeaders(new Headers({ Link: existing }), {
      canonicalUrl: 'https://example.com/other',
    });
    expect(headers.get('link')).toBe(existing);
  });

  it('adds a canonical Link alongside an unrelated existing Link', () => {
    const headers = applyMarkdownHeaders(new Headers({ Link: '</style.css>; rel="preload"' }), {
      canonicalUrl: 'https://example.com/docs',
    });
    expect(headers.get('link')).toContain('rel="preload"');
    expect(headers.get('link')).toContain('<https://example.com/docs>; rel="canonical"');
  });
});

describe('canonicalLinkHeader', () => {
  it('formats an RFC 8288 canonical link value', () => {
    expect(canonicalLinkHeader('https://example.com/x')).toBe(
      '<https://example.com/x>; rel="canonical"',
    );
  });
});
