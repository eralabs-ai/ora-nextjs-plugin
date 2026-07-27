#!/usr/bin/env node
import { runCli } from './cli.js';

// This file is the published `bin` entry point (`npx ax`). Kept separate from cli.ts
// so cli.ts stays a pure, testable function — this file's only job is process wiring.
try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (err) {
  // runCli only lets environment failures (e.g. an unwritable disk, missing permissions) reach
  // here — expected failure modes (bad args, invalid catalog) are handled inside it and never
  // throw. So this is most likely something about the host environment, not a bug in the CLI
  // itself — but if it looks wrong, an issue report is still welcome.
  console.error('[ax] Failed to run — check the error below for the cause:');
  console.error(err);
  console.error('[ax] If this looks like a bug in ax, please file an issue.');
  process.exitCode = 1;
}
