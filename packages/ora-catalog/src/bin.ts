#!/usr/bin/env node
import { runCli } from './cli.js';

// This file is the published `bin` entry point (`npx ora-catalog`). Kept separate from cli.ts
// so cli.ts stays a pure, testable function — this file's only job is process wiring.
try {
  process.exitCode = runCli(process.argv.slice(2));
} catch (err) {
  console.error('[ora-catalog] Unexpected error — this is a bug, please file an issue:');
  console.error(err);
  process.exitCode = 1;
}
