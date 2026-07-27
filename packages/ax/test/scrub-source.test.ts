import { describe, expect, it } from 'vitest';

import { scrubSource } from '../src/scrub-source.js';

/** The scrubber's core contract: same length, same newlines, so offsets and lines are preserved. */
function expectSameShape(source: string, scrubbed: string): void {
  expect(scrubbed).toHaveLength(source.length);
  expect(scrubbed.split('\n')).toHaveLength(source.split('\n').length);
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') expect(scrubbed[i]).toBe('\n');
  }
}

describe('scrubSource', () => {
  it('blanks // line comments but keeps the newline and the code after it', () => {
    const source = `const a = 1; // createMcpHandler(\nconst b = 2;\n`;
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    expect(scrubbed).not.toContain('createMcpHandler');
    expect(scrubbed).toContain('const a = 1;');
    expect(scrubbed).toContain('const b = 2;');
  });

  it('blanks /* */ block comments including delimiters, across lines', () => {
    const source = `/**\n * document.modelContext.registerTool({ name: 'ghost' })\n */\nconst a = 1;\n`;
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    expect(scrubbed).not.toContain('registerTool');
    expect(scrubbed).not.toContain('ghost');
    expect(scrubbed).not.toContain('/*');
    expect(scrubbed).not.toContain('*/');
    expect(scrubbed).toContain('const a = 1;');
  });

  it('blanks template literal contents but keeps the backticks', () => {
    const source = 'const html = `<form toolname="ghost_tool">`;\n';
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    expect(scrubbed).not.toContain('toolname');
    expect(scrubbed).not.toContain('ghost_tool');
    expect(scrubbed).toContain('const html = `');
    expect(scrubbed).toContain('`;');
  });

  it('leaves ordinary single- and double-quoted strings untouched', () => {
    const source = `import { createMcpHandler } from 'mcp-handler';\nserver.tool("roll_dice", {});\n`;
    expect(scrubSource(source)).toBe(source);
  });

  it('preserves offsets, so a match index in the scrubbed text points at the same source text', () => {
    const source = `// server.tool('decoy')\nserver.tool('real_tool');\n`;
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    const index = scrubbed.indexOf(`server.tool('real_tool')`);
    expect(index).toBeGreaterThan(-1);
    expect(source.slice(index, index + 24)).toBe(`server.tool('real_tool')`);
    // Line numbers survive too: the surviving call is still on line 2.
    expect(scrubbed.slice(0, index).split('\n')).toHaveLength(2);
  });

  it('does not let an escaped quote end a string early', () => {
    const source = `const a = 'it\\'s // not a comment';\nconst b = 2;\n`;
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    expect(scrubbed).toContain('not a comment');
    expect(scrubbed).toContain('const b = 2;');
  });

  it('does not let an escaped backtick end a template literal early', () => {
    const source = 'const a = `x \\` <form toolname="ghost">`;\nconst b = 2;\n';
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    expect(scrubbed).not.toContain('toolname');
    expect(scrubbed).toContain('const b = 2;');
  });

  it('treats a ${...} interpolation as code, not as blanked template content', () => {
    const source = 'const a = `prefix ${server.tool("live_tool", {})} suffix`;\n';
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    expect(scrubbed).toContain('server.tool("live_tool"');
    expect(scrubbed).not.toContain('prefix');
    expect(scrubbed).not.toContain('suffix');
  });

  it('does not read the quotes inside a regex literal as a string', () => {
    const source = `const RE = /['"]/;\n// createMcpHandler(\nconst after = 1;\n`;
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    // If the regex's quotes had opened a string state, the following comment would survive.
    expect(scrubbed).not.toContain('createMcpHandler');
    expect(scrubbed).toContain('const after = 1;');
  });

  it('handles a division that is not a regex without swallowing the rest of the file', () => {
    const source = `const half = total / 2;\nconst rest = other / 3;\nserver.tool('real_tool');\n`;
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    expect(scrubbed).toContain(`server.tool('real_tool')`);
  });

  it('resyncs at the newline on an unterminated string (a stray apostrophe in JSX text)', () => {
    const source = `<p>It's fine</p>\n<form toolname="real_tool" tooldescription="d" />\n`;
    const scrubbed = scrubSource(source);

    expectSameShape(source, scrubbed);
    expect(scrubbed).toContain('<form toolname="real_tool"');
  });

  it('is a no-op for source with nothing to scrub', () => {
    const source = `export function GET() {\n  return new Response('ok');\n}\n`;
    expect(scrubSource(source)).toBe(source);
  });

  it('handles an empty string and a lone comment', () => {
    expect(scrubSource('')).toBe('');
    expect(scrubSource('// only a comment')).toBe(' '.repeat('// only a comment'.length));
  });
});
