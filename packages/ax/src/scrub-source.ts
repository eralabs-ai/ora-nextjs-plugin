/**
 * Offset-preserving source scrubber shared by the textual detectors (detect-mcp, detect-webmcp).
 *
 * The detectors match patterns like `createMcpHandler(`, `.tool('name')` and
 * `document.modelContext.registerTool({...})` with plain regexes rather than an AST parse. That is
 * cheap and predictable, but a regex can't tell code from a comment or from the body of a template
 * literal, so a *mention* of an API — in a `//` note, a JSDoc block, or an HTML string built with
 * backticks — reads exactly like a call. Those mentions reached the emitted catalog (phantom tools,
 * phantom endpoints), which is a precision loss, not a recall loss.
 *
 * `scrubSource` removes the two contexts where a mention is never a call, and nothing else:
 *
 *   - `//` line comments and `/* *\/` block comments, delimiters included.
 *   - The *contents* of template literals (the backticks themselves are kept).
 *
 * Ordinary `'...'` / `"..."` string literals are deliberately left intact: the detectors legitimately
 * read tool names and JSX attribute values out of them (`.tool('roll_dice')`, `<form toolname="x">`).
 * Callers that need to reject a match sitting inside such a string do so with their own per-line
 * quote guard, which works precisely because scrubbing leaves those strings alone.
 *
 * The result is the same length as the input and keeps every newline in place, so match indices and
 * line numbers computed against the scrubbed text apply unchanged to the original.
 *
 * Known limitations (this is a lexer-shaped heuristic, not a parser):
 *   - `${...}` interpolations are scanned as code (so a call inside one is still visible), tracked by
 *     brace depth. Deeply nested template/interpolation combinations with unbalanced braces inside
 *     strings can desynchronize.
 *   - Regex literals are recognized by the usual previous-token heuristic; a `/` that follows an
 *     expression is read as division. A misjudged regex containing quotes or slashes can only
 *     confuse the scan until the end of that line — unterminated strings and regexes resync at the
 *     newline rather than swallowing the rest of the file.
 *   - `//` inside JSX *text* (a bare URL, say) is treated as a comment, blanking the rest of that
 *     line. Text in an attribute or a string is unaffected.
 */

type Frame = { kind: 'code'; braceDepth: number; interpolation: boolean } | { kind: 'template' };

/** Chars that, as the previous meaningful token, mean a following `/` opens a regex literal. */
const REGEX_PRECEDING_CHARS = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
  '\n',
]);
// `<` and `>` are deliberately absent: a regex after a comparison operator is vanishingly rare,
// while `<`/`>` are everywhere in JSX, where reading `/` as a regex start would misparse markup.

/** Keywords after which a `/` opens a regex literal rather than dividing. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'case',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'yield',
  'await',
  'throw',
]);

/**
 * Returns a copy of `source` with comments and template-literal contents replaced by spaces,
 * preserving length, newlines, and therefore every offset and line number.
 */
export function scrubSource(source: string): string {
  const out = source.split('');
  const stack: Frame[] = [{ kind: 'code', braceDepth: 0, interpolation: false }];
  // Last non-whitespace character seen in code context — enough to tell a regex literal from a
  // division, together with the identifier lookbehind in `startsRegex`.
  let previous = '\n';
  let i = 0;

  while (i < source.length) {
    const frame = stack[stack.length - 1] as Frame;
    const char = source[i] as string;
    const next = source[i + 1];

    if (frame.kind === 'template') {
      if (char === '\\') {
        blank(out, i);
        blank(out, i + 1);
        i += 2;
        continue;
      }
      if (char === '`') {
        stack.pop();
        previous = '`';
        i += 1;
        continue;
      }
      if (char === '$' && next === '{') {
        stack.push({ kind: 'code', braceDepth: 0, interpolation: true });
        previous = '{';
        i += 2;
        continue;
      }
      blank(out, i);
      i += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      i = blankLineComment(source, out, i);
      continue;
    }
    if (char === '/' && next === '*') {
      i = blankBlockComment(source, out, i);
      continue;
    }
    if (char === '"' || char === "'") {
      previous = char;
      i = skipQuoted(source, i, char);
      continue;
    }
    if (char === '`') {
      stack.push({ kind: 'template' });
      i += 1;
      continue;
    }
    if (char === '/' && startsRegex(source, i, previous)) {
      previous = '/';
      i = skipRegex(source, i);
      continue;
    }
    if (char === '{') {
      frame.braceDepth += 1;
    } else if (char === '}') {
      if (frame.interpolation && frame.braceDepth === 0) {
        stack.pop();
        previous = '`';
        i += 1;
        continue;
      }
      if (frame.braceDepth > 0) frame.braceDepth -= 1;
    }
    if (!isWhitespace(char)) previous = char;
    else if (char === '\n') previous = '\n';
    i += 1;
  }

  return out.join('');
}

function blank(out: string[], index: number): void {
  if (index >= out.length) return;
  if (out[index] !== '\n') out[index] = ' ';
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

/** Blanks `// ...` through to (but not including) the newline; returns the index to resume at. */
function blankLineComment(source: string, out: string[], start: number): number {
  let i = start;
  while (i < source.length && source[i] !== '\n') {
    blank(out, i);
    i += 1;
  }
  return i;
}

/** Blanks `/* ... *\/` including its delimiters, keeping newlines; returns the resume index. */
function blankBlockComment(source: string, out: string[], start: number): number {
  let i = start + 2;
  while (i < source.length) {
    if (source[i] === '*' && source[i + 1] === '/') {
      blank(out, i);
      blank(out, i + 1);
      i += 2;
      break;
    }
    blank(out, i);
    i += 1;
  }
  blank(out, start);
  blank(out, start + 1);
  return i;
}

/**
 * Skips a `'...'` / `"..."` literal, leaving its characters intact. An unterminated literal (a stray
 * apostrophe in JSX text, say) resyncs at the newline: the opening quote is consumed as a lone
 * character so the rest of the line is rescanned as code.
 */
function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '\n') break;
    if (char === quote) return i + 1;
    i += 1;
  }
  return start + 1;
}

/**
 * Skips a regex literal, leaving its characters intact — the point is only to keep the quotes and
 * slashes inside it from being read as string or comment delimiters. Bails (treating the `/` as
 * division) if the literal doesn't close on its own line.
 */
function skipRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '\n') break;
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return i + 1;
    i += 1;
  }
  return start + 1;
}

/** The usual previous-token heuristic for regex-literal vs. division. */
function startsRegex(source: string, index: number, previous: string): boolean {
  if (REGEX_PRECEDING_CHARS.has(previous)) return true;
  if (!/[A-Za-z]/.test(previous)) return false;
  const before = source.slice(Math.max(0, index - 20), index);
  const word = /([A-Za-z$_][A-Za-z0-9$_]*)\s*$/.exec(before);
  return word !== null && word[1] !== undefined && REGEX_PRECEDING_KEYWORDS.has(word[1]);
}
