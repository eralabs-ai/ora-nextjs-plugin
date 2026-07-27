import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectJsonLd } from '../src/detect-json-ld.js';

let dir: string;
let recommendations: string[];
const recommend = (message: string): void => {
  recommendations.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-detect-json-ld-'));
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeAppFile(relPath: string, contents: string): void {
  const full = join(dir, 'app', relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

describe('detectJsonLd', () => {
  it('recommends adding a block when there is no app/ directory', () => {
    const result = detectJsonLd({ cwd: dir, recommend });
    expect(result.found).toBe(false);
    expect(recommendations.join('\n')).toContain('No JSON-LD structured data found');
  });

  it('recommends adding a block when no layout/page contains application/ld+json', () => {
    writeAppFile('layout.tsx', 'export default function Layout() { return null; }');
    writeAppFile('page.tsx', 'export default function Page() { return null; }');

    const result = detectJsonLd({ cwd: dir, recommend });
    expect(result.found).toBe(false);
    expect(recommendations.join('\n')).toContain('sameAs');
    // Nudges toward a second @type (beyond Organization) for richer structured data.
    expect(recommendations.join('\n')).toContain('SoftwareApplication');
  });

  it('detects a JSON-LD block in the root layout and nudges toward Organization/sameAs', () => {
    writeAppFile(
      'layout.tsx',
      `export default function Layout() {
        return (
          <html><head>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: '{}' }} />
          </head></html>
        );
      }`,
    );

    const result = detectJsonLd({ cwd: dir, recommend });
    expect(result.found).toBe(true);
    expect(result.source).toBe(join('app', 'layout.tsx'));
    expect(recommendations.join('\n')).toContain('JSON-LD structured data detected');
    expect(recommendations.join('\n')).toContain('SoftwareApplication/Product');
  });

  it('detects a block in a nested page too', () => {
    writeAppFile('layout.tsx', 'export default function Layout() { return null; }');
    writeAppFile(
      join('about', 'page.tsx'),
      `export default function Page() { return <script type="application/ld+json">{}</script>; }`,
    );

    const result = detectJsonLd({ cwd: dir, recommend });
    expect(result.found).toBe(true);
    expect(result.source).toBe(join('app', 'about', 'page.tsx'));
  });

  it('finds an app dir nested under src/', () => {
    const full = join(dir, 'src', 'app', 'layout.tsx');
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, `<script type="application/ld+json">{}</script>`, 'utf8');

    const result = detectJsonLd({ cwd: dir, recommend });
    expect(result.found).toBe(true);
  });

  it('never throws — a scan is best-effort', () => {
    expect(() => detectJsonLd({ cwd: dir, recommend })).not.toThrow();
  });
});
