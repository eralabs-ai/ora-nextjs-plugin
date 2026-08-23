// Tier-1 twin derivation from an MDX page: the markdown *is* the source, so no HTML conversion is
// involved — just strip the non-markdown lines (imports/exports, JSX blocks, expression blocks) and
// keep the prose. The guard is the whole design: a component-heavy MDX page is mostly *behavior*,
// and a twin built by deleting its components would silently omit what the page actually shows, so
// past a threshold ax refuses and recommends instead of guessing. Stripping is line-based and
// deliberately lexer-grade, not an MDX parse — files it misjudges are pushed over the threshold and
// refused, never mis-converted (precision over recall).

/**
 * Maximum fraction of non-blank lines that may be non-markdown (imports/exports/JSX/expressions)
 * for a twin to be derived. Starting point per the plan's resolution (2026-08-19): strict, tuned
 * against the mdx-content fixture.
 */
export const MDX_MAX_NON_MARKDOWN_FRACTION = 0.25;

export type MdxTwinResult =
  | {
      ok: true;
      /** The MDX file's markdown lines, non-markdown stripped, trailing newline normalized. */
      markdown: string;
      /** First H1's text, else the source frontmatter's `title`, if either exists. */
      title?: string;
      /** The source frontmatter's `description`, if declared. */
      description?: string;
      /** Fraction of non-blank lines that were stripped — reported so the threshold is tunable. */
      strippedFraction: number;
    }
  | { ok: false; reason: 'mostly-jsx'; strippedFraction: number }
  | { ok: false; reason: 'empty-mdx' };

/** Opening/closing bracket balance of a line, for consuming multi-line statements. */
function bracketBalance(line: string): number {
  let balance = 0;
  for (const char of line) {
    if (char === '{' || char === '(') balance++;
    else if (char === '}' || char === ')') balance--;
  }
  return balance;
}

/** Net JSX tag depth of a line: opening tags minus closers and self-closers. */
function jsxDepthDelta(line: string): number {
  const opens = (line.match(/<[A-Za-z]/g) ?? []).length;
  const closes = (line.match(/<\//g) ?? []).length;
  const selfCloses = (line.match(/\/>/g) ?? []).length;
  return opens - closes - selfCloses;
}

interface SourceFrontmatter {
  title?: string;
  description?: string;
  /** Line count of the block including both `---` delimiters. */
  lineCount: number;
}

/**
 * Reads a leading `---` frontmatter block for the two keys twins reuse (`title`, `description` as
 * simple scalars). The block is metadata, not content — excluded from both the output and the
 * threshold arithmetic.
 */
function readSourceFrontmatter(lines: string[]): SourceFrontmatter | undefined {
  if (lines[0]?.trim() !== '---') return undefined;
  const result: SourceFrontmatter = { lineCount: 0 };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') {
      result.lineCount = i + 1;
      return result;
    }
    const match = /^(title|description):\s*(.+)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (match[1] === 'title') result.title = value;
      else result.description = value;
    }
  }
  return undefined; // unclosed --- block: treat the whole file as content, not frontmatter
}

/**
 * Derives twin markdown from an MDX page source, or refuses when too much of the file is
 * non-markdown ({@link MDX_MAX_NON_MARKDOWN_FRACTION}).
 */
export function deriveMdxTwin(source: string): MdxTwinResult {
  const allLines = source.split('\n');
  const frontmatter = readSourceFrontmatter(allLines);
  const lines = frontmatter !== undefined ? allLines.slice(frontmatter.lineCount) : allLines;

  const kept: string[] = [];
  let nonBlank = 0;
  let stripped = 0;
  let inFence = false;
  // > 0 while consuming a multi-line non-markdown construct (import/export/JSX/expression):
  // bracket-balance mode counts braces/parens, JSX mode counts tag depth.
  let pendingBalance = 0;
  let pendingJsxDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBlank = trimmed === '';
    if (!isBlank) nonBlank++;

    // Fenced code is markdown content whatever it contains — never classified as JSX/imports.
    if (!inFence && pendingBalance <= 0 && pendingJsxDepth <= 0 && /^(`{3,}|~{3,})/.test(trimmed)) {
      inFence = true;
      kept.push(line);
      continue;
    }
    if (inFence) {
      kept.push(line);
      if (/^(`{3,}|~{3,})/.test(trimmed)) inFence = false;
      continue;
    }

    if (pendingBalance > 0) {
      stripped += isBlank ? 0 : 1;
      pendingBalance += bracketBalance(line);
      continue;
    }
    if (pendingJsxDepth > 0) {
      stripped += isBlank ? 0 : 1;
      pendingJsxDepth += jsxDepthDelta(line);
      continue;
    }

    if (/^(import|export)\b/.test(trimmed)) {
      stripped++;
      const balance = bracketBalance(line);
      if (balance > 0) pendingBalance = balance;
      continue;
    }
    if (trimmed.startsWith('{')) {
      stripped++;
      const balance = bracketBalance(line);
      if (balance > 0) pendingBalance = balance;
      continue;
    }
    // A JSX block: `<Component ...>` / `</...>` / `<>` at the start of a line. Markdown has no
    // block-level construct that starts this way, so the misfire risk is inline HTML — which is
    // exactly what should be stripped or refused here anyway.
    if (/^<\/?[A-Za-z>]/.test(trimmed)) {
      stripped++;
      const depth = jsxDepthDelta(line);
      if (depth > 0) pendingJsxDepth = depth;
      continue;
    }

    kept.push(line);
  }

  if (nonBlank === 0) return { ok: false, reason: 'empty-mdx' };

  const strippedFraction = stripped / nonBlank;
  if (strippedFraction > MDX_MAX_NON_MARKDOWN_FRACTION) {
    return { ok: false, reason: 'mostly-jsx', strippedFraction };
  }

  const markdown = `${kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
  if (markdown.trim() === '') return { ok: false, reason: 'empty-mdx' };

  const h1 = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  const title = h1 ?? frontmatter?.title;
  return {
    ok: true,
    markdown,
    ...(title !== undefined ? { title } : {}),
    ...(frontmatter?.description !== undefined ? { description: frontmatter.description } : {}),
    strippedFraction,
  };
}
