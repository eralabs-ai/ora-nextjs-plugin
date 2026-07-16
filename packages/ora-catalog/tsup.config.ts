import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  dts: true,
  clean: true,
  sourcemap: true,
  // The hand-written spec schema (spec/ai-catalog.schema.json) is imported as JSON and
  // inlined into the bundle here, so the published package carries no runtime file dependency
  // on the repo's spec/ directory.
  loader: { '.json': 'json' },
});
