import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectJsonLd } from '../src/detect-json-ld.js';
import { buildRouterModel } from '../src/router-model.js';
import { scaffoldOrganizationJsonLd } from '../src/scaffold-json-ld.js';
import type { SiteMetadata } from '../src/site-metadata.js';

let dir: string;
let warnings: string[];
let recommendations: string[];
const warn = (message: string): void => {
  warnings.push(message);
};
const recommend = (message: string): void => {
  recommendations.push(message);
};

const site: SiteMetadata = { displayName: 'acme', description: 'Acme sells widgets.' };

function componentPath(extension = 'tsx'): string {
  return join(dir, 'app', `organization-json-ld.${extension}`);
}

/**
 * The `organization` object literal from the generated source, evaluated as the JavaScript it is.
 * Evaluating (rather than pattern-matching the text) is the point: it proves the generated file
 * parses and that what reaches `JSON.stringify` at render time is the block we meant to emit.
 */
function evaluateOrganization(source: string): Record<string, unknown> {
  const match = /const organization = (\{[\s\S]*?\n\});/.exec(source);
  if (!match?.[1]) throw new Error('no `organization` object literal in the generated component');
  return new Function(`return (${match[1]});`)() as Record<string, unknown>;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-scaffold-json-ld-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8');
  warnings = [];
  recommendations = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scaffoldOrganizationJsonLd', () => {
  it('writes app/organization-json-ld.tsx with an Organization block from package.json', () => {
    const result = scaffoldOrganizationJsonLd({
      cwd: dir,
      router: buildRouterModel(dir),
      siteUrl: 'https://example.com',
      site,
      warn,
    });

    expect(result).toMatchObject({ action: 'created', path: componentPath() });
    const source = readFileSync(componentPath(), 'utf8');
    expect(source).toContain('type="application/ld+json"');
    expect(evaluateOrganization(source)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'acme',
      description: 'Acme sells widgets.',
      url: 'https://example.com',
      sameAs: [],
    });
  });

  it('serializes to valid JSON — the block ends up in a <script> tag', () => {
    scaffoldOrganizationJsonLd({
      cwd: dir,
      router: buildRouterModel(dir),
      siteUrl: 'https://example.com',
      site,
      warn,
    });

    const organization = evaluateOrganization(readFileSync(componentPath(), 'utf8'));
    expect(JSON.parse(JSON.stringify(organization))).toEqual(organization);
  });

  it('escapes package.json values that would otherwise break the generated source', () => {
    scaffoldOrganizationJsonLd({
      cwd: dir,
      router: buildRouterModel(dir),
      siteUrl: 'https://example.com',
      site: { displayName: 'acme', description: 'Quote " backslash \\ and a\nnewline.' },
      warn,
    });

    const organization = evaluateOrganization(readFileSync(componentPath(), 'utf8'));
    expect(organization['description']).toBe('Quote " backslash \\ and a\nnewline.');
  });

  it('leaves sameAs empty with a TODO — external profiles are not statically derivable', () => {
    scaffoldOrganizationJsonLd({
      cwd: dir,
      router: buildRouterModel(dir),
      siteUrl: 'https://example.com',
      site,
      warn,
    });

    const source = readFileSync(componentPath(), 'utf8');
    expect(source).toContain('// TODO: list the external profiles');
    expect(evaluateOrganization(source)['sameAs']).toEqual([]);
  });

  it('leaves url as a TODO rather than guessing an origin when none resolved', () => {
    scaffoldOrganizationJsonLd({ cwd: dir, router: buildRouterModel(dir), site, warn });

    const source = readFileSync(componentPath(), 'utf8');
    expect(evaluateOrganization(source)['url']).toBe('');
    expect(source).toContain("TODO: your site's absolute production URL");
  });

  it('writes a .jsx component when the project has no tsconfig.json', () => {
    rmSync(join(dir, 'tsconfig.json'));

    const result = scaffoldOrganizationJsonLd({
      cwd: dir,
      router: buildRouterModel(dir),
      site,
      warn,
    });

    expect(result.path).toBe(componentPath('jsx'));
    expect(existsSync(componentPath())).toBe(false);
  });

  it('never overwrites an existing component, and still reports how to wire it up', () => {
    writeFileSync(componentPath(), '// hand-edited\n', 'utf8');

    const result = scaffoldOrganizationJsonLd({
      cwd: dir,
      router: buildRouterModel(dir),
      siteUrl: 'https://example.com',
      site,
      warn,
    });

    expect(result.action).toBe('exists');
    expect(readFileSync(componentPath(), 'utf8')).toBe('// hand-edited\n');
    expect(result.wiring).toEqual({
      importLine: "import { OrganizationJsonLd } from './organization-json-ld';",
      element: '<OrganizationJsonLd />',
      layoutPath: join('app', 'layout.tsx'),
    });
  });

  it('skips (rather than throws) when there is no router directory', () => {
    rmSync(join(dir, 'app'), { recursive: true, force: true });
    const result = scaffoldOrganizationJsonLd({
      cwd: dir,
      router: buildRouterModel(dir),
      site,
      warn,
    });
    expect(result).toMatchObject({ action: 'skipped' });
    expect(result.reason).toContain('Router');
  });
});

describe('detectJsonLd — scaffold wiring', () => {
  it('writes nothing when scaffoldJsonLd is off', () => {
    const result = detectJsonLd({ cwd: dir, recommend });

    expect(result).toEqual({ found: false });
    expect(existsSync(componentPath())).toBe(false);
    expect(recommendations.join('\n')).toContain('No JSON-LD structured data found');
  });

  it('scaffolds the component and recommends the exact edit that publishes it', () => {
    const result = detectJsonLd({
      cwd: dir,
      recommend,
      warn,
      scaffold: true,
      site,
      siteUrl: 'https://example.com',
    });

    // Still `found: false`: a component nothing imports renders no structured data.
    expect(result.found).toBe(false);
    expect(result.scaffold?.action).toBe('created');
    const message = recommendations.join('\n');
    expect(message).toContain("import { OrganizationJsonLd } from './organization-json-ld';");
    expect(message).toContain('<OrganizationJsonLd />');
    expect(message).toContain(join('app', 'layout.tsx'));
  });

  it('never scaffolds over an existing JSON-LD block in a layout', () => {
    writeFileSync(
      join(dir, 'app', 'layout.tsx'),
      'export default function Layout() {\n' +
        '  return <script type="application/ld+json">{}</script>;\n' +
        '}\n',
      'utf8',
    );

    const result = detectJsonLd({ cwd: dir, recommend, warn, scaffold: true, site });

    expect(result).toMatchObject({ found: true, source: join('app', 'layout.tsx') });
    expect(existsSync(componentPath())).toBe(false);
  });

  it('counts the scaffolded component as JSON-LD once a layout imports it', () => {
    detectJsonLd({ cwd: dir, recommend, warn, scaffold: true, site, siteUrl: 'https://x.example' });
    writeFileSync(
      join(dir, 'app', 'layout.tsx'),
      "import { OrganizationJsonLd } from './organization-json-ld';\n" +
        'export default function Layout() {\n' +
        '  return <OrganizationJsonLd />;\n' +
        '}\n',
      'utf8',
    );

    // The wired-up pair is the whole point of the scaffold: without this the check would stay
    // actionable forever, even after the developer did exactly what ax asked.
    recommendations = [];
    const result = detectJsonLd({ cwd: dir, recommend, warn, scaffold: true, site });

    expect(result).toMatchObject({ found: true, source: join('app', 'layout.tsx') });
    expect(recommendations.join('\n')).toContain('JSON-LD structured data detected');
  });

  it('does not count the component while nothing imports it', () => {
    detectJsonLd({ cwd: dir, recommend, warn, scaffold: true, site, siteUrl: 'https://x.example' });
    writeFileSync(join(dir, 'app', 'layout.tsx'), 'export default function L() { return null; }\n');

    const result = detectJsonLd({ cwd: dir, recommend, warn, scaffold: true, site });

    expect(result.found).toBe(false);
    expect(result.scaffold?.action).toBe('exists');
  });
});
