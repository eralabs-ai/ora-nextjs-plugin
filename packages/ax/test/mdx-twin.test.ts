import { describe, expect, it } from 'vitest';

import { deriveMdxTwin, MDX_MAX_NON_MARKDOWN_FRACTION } from '../src/mdx-twin.js';

const PROSE = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} of real prose content.`).join(
  '\n\n',
);

describe('deriveMdxTwin', () => {
  it('keeps markdown and strips imports/exports and JSX blocks', () => {
    const source = `import { Callout } from 'nextra'\nexport const meta = { a: 1 }\n\n# Guide\n\n${PROSE}\n\n<Callout type="info">\n  component body\n</Callout>\n`;
    const result = deriveMdxTwin(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain('# Guide');
    expect(result.markdown).toContain('Paragraph 3');
    expect(result.markdown).not.toContain('import');
    expect(result.markdown).not.toContain('Callout');
    expect(result.markdown).not.toContain('component body');
    expect(result.title).toBe('Guide');
  });

  it('refuses a component-heavy file with the mostly-jsx reason and the measured fraction', () => {
    const source = `import A from 'a'\nimport B from 'b'\n\n<A>\n  <B />\n</A>\n\nOne line of prose.\n`;
    const result = deriveMdxTwin(source);
    expect(result).toMatchObject({ ok: false, reason: 'mostly-jsx' });
    if (result.ok || result.reason !== 'mostly-jsx') return;
    expect(result.strippedFraction).toBeGreaterThan(MDX_MAX_NON_MARKDOWN_FRACTION);
  });

  it('reads title/description from the source frontmatter without counting it against the threshold', () => {
    const source = `---\ntitle: "The Guide"\ndescription: All about it.\n---\n\n${PROSE}\n`;
    const result = deriveMdxTwin(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe('The Guide');
    expect(result.description).toBe('All about it.');
    expect(result.markdown).not.toContain('title:');
  });

  it('an H1 in the content wins over the frontmatter title', () => {
    const source = `---\ntitle: Frontmatter Title\n---\n\n# Real Heading\n\n${PROSE}\n`;
    const result = deriveMdxTwin(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe('Real Heading');
  });

  it('never classifies fenced-code content as JSX or imports', () => {
    const source = `# Code\n\n${PROSE}\n\n\`\`\`tsx\nimport x from 'y'\n<Component />\n\`\`\`\n`;
    const result = deriveMdxTwin(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain("import x from 'y'");
    expect(result.markdown).toContain('<Component />');
  });

  it('consumes a multi-line import statement as one stripped construct', () => {
    const source = `import {\n  A,\n  B,\n} from 'pkg'\n\n# Title\n\n${PROSE}\n`;
    const result = deriveMdxTwin(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).not.toContain('from');
    expect(result.markdown).toContain('# Title');
  });

  it('refuses an empty or whitespace-only file', () => {
    expect(deriveMdxTwin('\n\n  \n')).toEqual({ ok: false, reason: 'empty-mdx' });
  });
});
