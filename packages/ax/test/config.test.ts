import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAxConfig, AxConfigError } from '../src/config.js';

let dir: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ax-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe('loadAxConfig', () => {
  it('defaults every field when no config file exists (isGated stays unset)', async () => {
    const { config, path } = await loadAxConfig(dir);
    expect(path).toBeUndefined();
    expect(config).toEqual({
      siteUrl: undefined,
      emit: 'static',
      scaffoldLlmsTxt: false,
      scaffoldAgent404: false,
      scaffoldRobots: false,
      scaffoldJsonLd: false,
      markdownTwins: true,
      publishSkills: false,
      report: false,
      entries: [],
    });
    // No isGated key at all — resolveGating supplies the built-in floor when it's absent.
    expect('isGated' in config).toBe(false);
  });

  it('loads a CommonJS .js config', async () => {
    writeFileSync(join(dir, 'ax.config.js'), "module.exports = { emit: 'route' };\n", 'utf8');
    const { config, path } = await loadAxConfig(dir);
    expect(path).toBe(join(dir, 'ax.config.js'));
    expect(config.emit).toBe('route');
  });

  it('loads an ESM .mjs config with a default export', async () => {
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://example.com' };\n",
      'utf8',
    );
    const { config } = await loadAxConfig(dir);
    expect(config.siteUrl).toBe('https://example.com');
  });

  it('loads a TypeScript .ts config', async () => {
    writeFileSync(
      join(dir, 'ax.config.ts'),
      [
        'interface Config { entries: Array<{ identifier: string; url: string }> }',
        'const config: Config = { entries: [{ identifier: "urn:demo:docs", url: "/docs" }] };',
        'export default config;',
        '',
      ].join('\n'),
      'utf8',
    );
    const { config } = await loadAxConfig(dir);
    expect(config.entries).toEqual([{ identifier: 'urn:demo:docs', url: '/docs' }]);
  });

  it('picks .ts over .js when both exist (declared lookup order)', async () => {
    writeFileSync(
      join(dir, 'ax.config.ts'),
      "export default { siteUrl: 'https://ts.example.com' };\n",
    );
    writeFileSync(
      join(dir, 'ax.config.js'),
      "module.exports = { siteUrl: 'https://js.example.com' };\n",
    );
    const { config, path } = await loadAxConfig(dir);
    expect(path).toBe(join(dir, 'ax.config.ts'));
    expect(config.siteUrl).toBe('https://ts.example.com');
  });

  // `isGated` is a function, which JSON Schema has no type for, so it's validated with a `typeof`
  // check rather than Ajv — and the closed (`additionalProperties: false`) top-level schema must
  // not reject it as an unknown key.
  describe('isGated', () => {
    it('loads a function isGated and applies its whole-artifact policy', async () => {
      writeFileSync(
        join(dir, 'ax.config.mjs'),
        "export default { isGated: ({ path }) => path.startsWith('/internal') };\n",
        'utf8',
      );
      const { config } = await loadAxConfig(dir);
      expect(typeof config.isGated).toBe('function');
      expect(config.isGated?.({ kind: 'entry', path: '/internal/x' })).toBe(true);
      expect(config.isGated?.({ kind: 'entry', path: '/public' })).toBe(false);
    });

    it('throws AxConfigError when isGated is present but not a function', async () => {
      writeFileSync(join(dir, 'ax.config.mjs'), 'export default { isGated: 123 };\n', 'utf8');
      await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
      await expect(loadAxConfig(dir)).rejects.toThrow(/isGated/);
    });

    it('accepts a config that mixes isGated with other keys (no additionalProperties false trip)', async () => {
      writeFileSync(
        join(dir, 'ax.config.mjs'),
        "export default { siteUrl: 'https://example.com', isGated: () => true };\n",
        'utf8',
      );
      const { config } = await loadAxConfig(dir);
      expect(config.siteUrl).toBe('https://example.com');
      expect(typeof config.isGated).toBe('function');
    });
  });

  // `publishSkills` accepts either a boolean (auto-discover root-level `skills/*`) or an explicit
  // list of root-relative skill directory paths (the only way to reach into `.claude/skills/`).
  describe('publishSkills', () => {
    it('accepts true', async () => {
      writeFileSync(join(dir, 'ax.config.js'), 'module.exports = { publishSkills: true };\n');
      const { config } = await loadAxConfig(dir);
      expect(config.publishSkills).toBe(true);
    });

    it('accepts false', async () => {
      writeFileSync(join(dir, 'ax.config.js'), 'module.exports = { publishSkills: false };\n');
      const { config } = await loadAxConfig(dir);
      expect(config.publishSkills).toBe(false);
    });

    it('accepts an explicit list of skill directories, including under .claude/skills/', async () => {
      writeFileSync(
        join(dir, 'ax.config.js'),
        "module.exports = { publishSkills: ['skills/foo', '.claude/skills/bar'] };\n",
      );
      const { config } = await loadAxConfig(dir);
      expect(config.publishSkills).toEqual(['skills/foo', '.claude/skills/bar']);
    });

    it('rejects a string (only boolean or string[] are valid shapes)', async () => {
      writeFileSync(join(dir, 'ax.config.js'), "module.exports = { publishSkills: 'yes' };\n");
      await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
      await expect(loadAxConfig(dir)).rejects.toThrow(/publishSkills/);
    });

    it('rejects a non-string array item', async () => {
      writeFileSync(join(dir, 'ax.config.js'), 'module.exports = { publishSkills: [1] };\n');
      await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
      await expect(loadAxConfig(dir)).rejects.toThrow(/publishSkills/);
    });

    it('rejects an empty string array item', async () => {
      writeFileSync(join(dir, 'ax.config.js'), "module.exports = { publishSkills: [''] };\n");
      await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
      await expect(loadAxConfig(dir)).rejects.toThrow(/publishSkills/);
    });
  });

  // `ard.config.*` was `ax.config.*`'s pre-rename name; support for it was dropped (pre-1.0,
  // maintainer-approved breaking change). An `ard.config.*`-only project is not "unconfigured" —
  // it has real settings sitting under a name this loader no longer reads — so silently falling
  // back to defaults would drop them without telling anyone. It must fail loudly instead, same as
  // an invalid `ax.config.*` does.
  it('throws AxConfigError with a rename message when only a legacy ard.config.* exists', async () => {
    writeFileSync(
      join(dir, 'ard.config.mjs'),
      "export default { siteUrl: 'https://legacy.example.com' };\n",
    );
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
    await expect(loadAxConfig(dir)).rejects.toThrow(
      /ard\.config\.mjs.*rename it to ax\.config\.mjs/is,
    );
  });

  it('throws the same rename error regardless of the legacy file extension', async () => {
    writeFileSync(join(dir, 'ard.config.ts'), "export default { siteUrl: 'https://x.com' };\n");
    await expect(loadAxConfig(dir)).rejects.toThrow(/rename it to ax\.config\.ts/i);
  });

  // Once `ax.config.*` exists, the project has migrated — a leftover `ard.config.*` is ignored
  // outright, not merged, and not even evaluated, so a stale one that throws can't fail a build
  // that already migrated. No warning either: unsupported means unsupported, not deprecated.
  it('ignores a legacy ard.config.* entirely once ax.config.* exists', async () => {
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      "export default { siteUrl: 'https://new.example.com' };\n",
    );
    writeFileSync(join(dir, 'ard.config.mjs'), "throw new Error('boom');\n");
    const { config, path } = await loadAxConfig(dir);
    expect(path).toBe(join(dir, 'ax.config.mjs'));
    expect(config.siteUrl).toBe('https://new.example.com');
  });

  it('throws AxConfigError with an actionable message on an invalid shape', async () => {
    writeFileSync(
      join(dir, 'ax.config.js'),
      'module.exports = { emit: "not-a-target" };\n',
      'utf8',
    );
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
    await expect(loadAxConfig(dir)).rejects.toThrow(/emit/);
  });

  it('throws AxConfigError on an unrecognized top-level key (typo guard)', async () => {
    writeFileSync(
      join(dir, 'ax.config.js'),
      'module.exports = { scaffoldRobot: true };\n', // missing trailing 's'
      'utf8',
    );
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
  });

  it('throws AxConfigError when the config file itself throws while loading', async () => {
    writeFileSync(join(dir, 'ax.config.js'), "throw new Error('boom');\n", 'utf8');
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
  });

  it('never partially applies an invalid config — defaults are all-or-nothing', async () => {
    writeFileSync(
      join(dir, 'ax.config.js'),
      'module.exports = { siteUrl: "https://ok.example.com", emit: 123 };\n',
      'utf8',
    );
    await expect(loadAxConfig(dir)).rejects.toThrow(AxConfigError);
  });

  // `ax.config.*` is evaluated as real code (via jiti), not parsed as static JSON — so reading
  // `siteUrl` from a project's own env var, without any special support from the plugin, must
  // keep working. There's no single env var name to support directly (see README): different
  // hosts use different conventions, so this is deliberately left to the developer's own config.
  it('reads siteUrl from an arbitrary env var the developer chooses to read', async () => {
    process.env.MY_CUSTOM_SITE_URL = 'https://from-env.example.com';
    writeFileSync(
      join(dir, 'ax.config.mjs'),
      'export default { siteUrl: process.env.MY_CUSTOM_SITE_URL };\n',
      'utf8',
    );
    const { config } = await loadAxConfig(dir);
    expect(config.siteUrl).toBe('https://from-env.example.com');
  });
});
