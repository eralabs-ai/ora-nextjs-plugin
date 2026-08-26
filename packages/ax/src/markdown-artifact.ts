// The shared contract for every markdown file ax *generates* (twins, auth.md): a YAML frontmatter
// block carrying the keys agent-readiness audits look for, plus a generated-by marker so humans and
// tools know the file is build output, never a scaffold to edit. All four content keys are derivable
// at build time; none is ever invented:
//   - `title` / `description` — from the page the file represents (its <title>/meta, or an H1).
//   - `canonical_url` — the HTML page this markdown stands in for; the attribution link a crawler
//     needs so citations land on the page, not the twin.
//   - `last_updated` — the build time. Truthful by construction: a generated file is exactly as
//     fresh as the build that wrote it.

/** The `generated-by` frontmatter value marking a file as ax build output (regenerated, not yours). */
export const GENERATED_BY = '@ora-ai/ax-nextjs';

/** Matches a generated-by frontmatter line anywhere in a file's opening frontmatter block. */
const GENERATED_BY_RE = /^generated-by:\s*["']?@ora-ai\/ax-nextjs["']?\s*$/m;

export interface MarkdownFrontmatter {
  title: string;
  /** Omitted (never an empty placeholder) when the page declares no description. */
  description?: string;
  /** Absolute when the site origin resolved; the served path otherwise — still resolvable. */
  canonicalUrl: string;
  /** ISO 8601 build timestamp. */
  lastUpdated: string;
}

/** Escapes a value for a double-quoted YAML scalar (quotes and backslashes; newlines collapse). */
function yamlString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s*\n\s*/g, ' ')}"`;
}

/** Renders the frontmatter block, ending with the closing `---` and a trailing newline. */
export function renderFrontmatter(frontmatter: MarkdownFrontmatter): string {
  const lines = [
    '---',
    `title: ${yamlString(frontmatter.title)}`,
    ...(frontmatter.description !== undefined
      ? [`description: ${yamlString(frontmatter.description)}`]
      : []),
    `canonical_url: ${frontmatter.canonicalUrl}`,
    `last_updated: ${frontmatter.lastUpdated}`,
    `generated-by: "${GENERATED_BY}"`,
    '---',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Whether a markdown file on disk is ax-generated (carries the generated-by frontmatter marker).
 * This is the overwrite guard's whole basis: a `.md` *without* the marker is user-authored — it IS
 * the markdown source for its route, and ax must never touch it.
 */
export function isGeneratedMarkdown(content: string): boolean {
  if (!content.startsWith('---')) return false;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return false;
  return GENERATED_BY_RE.test(content.slice(0, end));
}

/**
 * Count of column-0 code-fence markers (``` or ~~~). An odd count means an unclosed fence, which
 * corrupts everything below it in an agent's context — generated markdown must never ship one.
 */
export function fenceMarkerCount(markdown: string): number {
  return (markdown.match(/^(`{3,}|~{3,})/gm) ?? []).length;
}
