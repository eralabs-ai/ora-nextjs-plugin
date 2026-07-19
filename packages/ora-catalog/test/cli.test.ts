import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { CATALOG_OUTPUT_PATH } from '../src/write.js';

let dir: string;
let stdout: string[];
let stderr: string[];
const io = {
  stdout: (line: string) => stdout.push(line),
  stderr: (line: string) => stderr.push(line),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ora-catalog-cli-'));
  stdout = [];
  stderr = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runCli', () => {
  it('writes a valid catalog and exits 0', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const code = runCli([], { ...io, cwd: dir });

    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
    expect(stdout.some((l) => l.includes('wrote'))).toBe(true);
    expect(stderr).toEqual([]);
  });

  it('accepts --cwd as an explicit override', () => {
    const code = runCli(['--cwd', dir], io);
    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
  });

  it('accepts --cwd=<dir> equals form', () => {
    const code = runCli([`--cwd=${dir}`], io);
    expect(code).toBe(0);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(true);
  });

  it('exits 1 with a clear message when --cwd= has an empty value', () => {
    const code = runCli(['--cwd='], { ...io, cwd: dir });
    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('--cwd requires a directory argument'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('prints help and exits 0 for --help, without writing anything', () => {
    const code = runCli(['--help'], { ...io, cwd: dir });
    expect(code).toBe(0);
    expect(stdout.some((l) => l.includes('Usage:'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('exits 1 with a clear message on an unrecognized argument', () => {
    const code = runCli(['--bogus'], { ...io, cwd: dir });
    expect(code).toBe(1);
    expect(stderr.some((l) => l.includes('Unrecognized argument'))).toBe(true);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('exits 1 and reports errors without writing when --cwd is missing its value', () => {
    const code = runCli(['--cwd'], { ...io, cwd: dir });
    expect(code).toBe(1);
    expect(existsSync(join(dir, CATALOG_OUTPUT_PATH))).toBe(false);
  });

  it('defaults to process.cwd() when no cwd is given anywhere', () => {
    // Just verifies it doesn't throw when relying on the real process cwd; output location isn't
    // asserted since it would write into the real repo.
    const originalCwd = process.cwd;
    process.cwd = () => dir;
    try {
      const code = runCli([], io);
      expect(code).toBe(0);
    } finally {
      process.cwd = originalCwd;
    }
  });

  it('writes a catalog that round-trips as valid JSON', () => {
    runCli([], { ...io, cwd: dir });
    const parsed = JSON.parse(readFileSync(join(dir, CATALOG_OUTPUT_PATH), 'utf8'));
    expect(parsed.specVersion).toBe('1.0');
    expect(parsed.entries).toEqual([]);
  });
});
