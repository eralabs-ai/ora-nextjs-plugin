import { describe, expect, it } from 'vitest';

import { deriveHtmlTwin, MIN_TWIN_TEXT_CHARS } from '../src/html-twin.js';
import { fenceMarkerCount } from '../src/markdown-artifact.js';

/** Enough real text to clear the shell guard. */
const FILLER = 'Real page content that an agent would want to read, not chrome. '.repeat(5);

function page(main: string, head = ''): string {
  return `<html><head><title>Acme Docs</title><meta name="description" content="Acme's docs."/>${head}</head><body><nav><a href="/">home</a></nav>${main}<footer>© Acme</footer></body></html>`;
}

describe('deriveHtmlTwin', () => {
  it('converts only the <main> region — nav and footer chrome never reach the twin', async () => {
    const result = await deriveHtmlTwin(page(`<main><h1>Docs</h1><p>${FILLER}</p></main>`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain('# Docs');
    expect(result.markdown).not.toContain('home');
    expect(result.markdown).not.toContain('© Acme');
    expect(result.title).toBe('Acme Docs');
    expect(result.description).toBe("Acme's docs.");
  });

  it('falls back to <article> when there is no <main>', async () => {
    const result = await deriveHtmlTwin(page(`<article><h1>Post</h1><p>${FILLER}</p></article>`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain('# Post');
  });

  it('skips a page with neither landmark rather than converting <body>', async () => {
    const result = await deriveHtmlTwin(page(`<div><h1>Divs</h1><p>${FILLER}</p></div>`));
    // The refusal still carries the resolved head — the metadata twin rung reads it.
    expect(result).toEqual({
      ok: false,
      reason: 'no-content-region',
      title: 'Acme Docs',
      description: "Acme's docs.",
    });
  });

  it('skips a JS-shell page (under the text minimum) — an empty twin is a lie', async () => {
    const result = await deriveHtmlTwin(page('<main><div id="root"></div></main>'));
    expect(result).toMatchObject({ ok: false, reason: 'too-little-text', title: 'Acme Docs' });
    // Sanity: the guard threshold is what the audit criterion draws the line at.
    expect(MIN_TWIN_TEXT_CHARS).toBe(200);
  });

  it('strips scripts/styles inside the region (RSC payloads never leak into a twin)', async () => {
    const result = await deriveHtmlTwin(
      page(
        `<main><p>${FILLER}</p><script>self.__next_f.push(["payload"])</script><style>p{color:red}</style></main>`,
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).not.toContain('__next_f');
    expect(result.markdown).not.toContain('color:red');
  });

  it('converts GFM structures (tables, fenced code, lists, links) with balanced fences', async () => {
    const result = await deriveHtmlTwin(
      page(
        `<main><p>${FILLER}</p><pre><code>npm i acme</code></pre>` +
          '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
          '<ul><li>one</li><li><a href="/docs">two</a></li></ul></main>',
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain('npm i acme');
    expect(result.markdown).toContain('| a | b |');
    expect(result.markdown).toContain('[two](/docs)');
    expect(fenceMarkerCount(result.markdown) % 2).toBe(0);
  });
});
