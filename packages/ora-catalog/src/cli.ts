import { ArdConfigError } from './config.js';
import { generateCatalog } from './generate.js';
import { writeCatalog } from './write.js';

const HELP_TEXT = `ora-catalog — generate a spec-valid ai-catalog.json at build time

Usage:
  ora-catalog [options]

Options:
  --cwd <dir>,
  --cwd=<dir>   Project root to run in (defaults to the current working directory).
                Run this from your Next.js app's root, typically as a "postbuild" script.
  -h, --help    Print this help text.

Writes public/.well-known/ai-catalog.json. Validates the generated catalog against the AI Catalog
spec before writing; refuses to write (and exits non-zero) if it doesn't validate.
`;

export interface CliIO {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

interface ParsedArgs {
  help: boolean;
  cwd?: string;
}

class CliArgError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    } else if (arg === '--cwd') {
      const value = argv[i + 1];
      if (value === undefined) throw new CliArgError('--cwd requires a directory argument');
      parsed.cwd = value;
      i++;
    } else if (arg.startsWith('--cwd=')) {
      const value = arg.slice('--cwd='.length);
      if (value === '') throw new CliArgError('--cwd requires a directory argument');
      parsed.cwd = value;
    } else {
      throw new CliArgError(`Unrecognized argument: ${arg}`);
    }
  }
  return parsed;
}

/**
 * Runs the CLI end to end and returns a process exit code. Never throws for expected failure
 * modes (bad args, invalid catalog, invalid `ard.config`) — those are reported via `stderr` and a
 * non-zero code. Only an unexpected environment failure (e.g. an unwritable disk)
 * propagates as a thrown error, since the bin entry point is better placed to decide how to
 * present that.
 */
export async function runCli(argv: string[], io: CliIO = {}): Promise<number> {
  const stdout = io.stdout ?? ((line: string) => console.log(line));
  const stderr = io.stderr ?? ((line: string) => console.error(line));

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr(`[ora-catalog] ${(err as Error).message}`);
    stderr(HELP_TEXT);
    return 1;
  }

  if (args.help) {
    stdout(HELP_TEXT);
    return 0;
  }

  const cwd = args.cwd ?? io.cwd ?? process.cwd();

  const warnings: string[] = [];
  let catalog;
  try {
    catalog = await generateCatalog({ cwd, onWarning: (message) => warnings.push(message) });
  } catch (err) {
    if (err instanceof ArdConfigError) {
      stderr(`[ora-catalog] ${err.message}`);
      return 1;
    }
    throw err;
  }

  for (const warning of warnings) stdout(`[ora-catalog] ⚠ ${warning}`);

  const result = writeCatalog(cwd, catalog);

  if (!result.ok) {
    stderr('[ora-catalog] Generated catalog failed spec validation — refusing to write it:');
    stderr(result.errors);
    stderr(
      '[ora-catalog] This is a bug in ora-catalog itself, not your app. Please file an issue.',
    );
    return 1;
  }

  stdout(`[ora-catalog] ✓ wrote ${result.path}`);
  stdout(
    `[ora-catalog] ✓ ${catalog.entries.length} entries (config-declared only — zero-config ` +
      'artifact detection for MCP/OpenAPI/docs/skills/llms.txt lands in Phase 2.2)',
  );
  return 0;
}
