import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectSitemap } from '../src/detect-sitemap.js';

let dir: string;
let recommendations: string[];
const recommend = (message: string): void => {
  recommendations.push(message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-detect-sitemap-'));
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectSitemap', () => {
  it('detects an App Router app/sitemap.ts', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'sitemap.ts'), 'export default function sitemap() {}\n', 'utf8');

    const result = detectSitemap({ cwd: dir, recommend });

    expect(result.found).toBe(true);
    expect(result.source).toBe(join(dir, 'app', 'sitemap.ts'));
    expect(recommendations.some((r) => r.includes('sitemap detected'))).toBe(true);
    expect(recommendations.some((r) => r.includes('Sitemap:'))).toBe(true);
  });

  it('detects a static public/sitemap.xml', () => {
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(dir, 'public', 'sitemap.xml'), '<urlset></urlset>\n', 'utf8');

    const result = detectSitemap({ cwd: dir, recommend });
    expect(result.found).toBe(true);
    expect(result.source).toBe(join(dir, 'public', 'sitemap.xml'));
  });

  it('recommends next-sitemap (never reimplements) when absent', () => {
    const result = detectSitemap({ cwd: dir, recommend });

    expect(result.found).toBe(false);
    const message = recommendations.join('\n');
    expect(message).toContain('No sitemap found');
    expect(message).toContain('next-sitemap');
    expect(message).toContain('never generates a sitemap itself');
  });
});
