import { defineConfig } from 'tsup';

export default defineConfig({
  // `middleware` is its own entry (and package export) because it is the only code a consumer's
  // app imports at runtime: it must stay Web-API-only and free of the CLI's dependencies, which
  // the middleware import-graph test asserts.
  entry: {
    index: 'src/index.ts',
    bin: 'src/bin.ts',
    middleware: 'src/middleware/index.ts',
  },
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
