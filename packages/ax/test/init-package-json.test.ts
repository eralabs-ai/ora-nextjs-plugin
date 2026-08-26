import { describe, expect, it } from 'vitest';

import { planPostbuildWiring, planPrebuildWiring } from '../src/init-package-json.js';

describe('planPostbuildWiring', () => {
  it('adds a postbuild when scripts are absent entirely', () => {
    expect(planPostbuildWiring(undefined)).toEqual({ action: 'add' });
  });

  it('adds a postbuild when one is missing from an existing scripts block', () => {
    expect(planPostbuildWiring({ build: 'next build' })).toEqual({ action: 'add' });
  });

  it('adds a postbuild when the field exists but is blank', () => {
    expect(planPostbuildWiring({ postbuild: '   ' })).toEqual({ action: 'add' });
  });

  it('treats a bare `ax` postbuild as already wired', () => {
    expect(planPostbuildWiring({ postbuild: 'ax' })).toEqual({ action: 'already-wired' });
    expect(planPostbuildWiring({ postbuild: 'ax --report --yes' })).toEqual({
      action: 'already-wired',
    });
  });

  it('treats ax chained into a longer postbuild as already wired', () => {
    expect(planPostbuildWiring({ postbuild: 'next-sitemap && ax' })).toEqual({
      action: 'already-wired',
    });
  });

  it('recognizes runner-prefixed and path forms of ax as already wired', () => {
    for (const command of ['npx ax', 'pnpm exec ax', 'node_modules/.bin/ax', 'ax --report --yes']) {
      expect(planPostbuildWiring({ postbuild: command }), command).toEqual({
        action: 'already-wired',
      });
    }
  });

  it('does not touch a foreign postbuild — it prints the exact manual edit instead', () => {
    const plan = planPostbuildWiring({ postbuild: 'next-sitemap' });
    expect(plan.action).toBe('manual');
    if (plan.action !== 'manual') throw new Error('expected manual');
    expect(plan.existing).toBe('next-sitemap');
    expect(plan.instruction).toContain('"postbuild": "next-sitemap && ax"');
  });

  it('does not mistake a script whose name merely contains "ax" for ax itself', () => {
    // `relax` starts with the letters of `ax` but is not the ax command.
    expect(planPostbuildWiring({ postbuild: 'relax-thing' }).action).toBe('manual');
  });
});

describe('planPrebuildWiring', () => {
  it('adds when no prebuild exists or it is blank', () => {
    expect(planPrebuildWiring(undefined)).toEqual({ action: 'add' });
    expect(planPrebuildWiring({ build: 'next build' })).toEqual({ action: 'add' });
    expect(planPrebuildWiring({ prebuild: '  ' })).toEqual({ action: 'add' });
  });

  it('recognizes an existing ax manifest wiring in any runner form', () => {
    expect(planPrebuildWiring({ prebuild: 'ax manifest' })).toEqual({ action: 'already-wired' });
    expect(planPrebuildWiring({ prebuild: 'npx ax manifest' })).toEqual({
      action: 'already-wired',
    });
  });

  it('never chains into a foreign prebuild — prints the exact edit instead', () => {
    const plan = planPrebuildWiring({ prebuild: 'node scripts/env.js' });
    expect(plan.action).toBe('manual');
    if (plan.action !== 'manual') return;
    expect(plan.instruction).toContain('"prebuild"');
    expect(plan.instruction).toContain('node scripts/env.js && ax manifest');
  });
});
