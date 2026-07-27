import { resolve } from 'node:path';

import { ArdConfigError } from './config.js';
import { generateCatalog } from './generate.js';
import { writeCatalog, writeReport, writeServerCard } from './write.js';

const HELP_TEXT = `ax — generate a spec-valid ai-catalog.json at build time

Usage:
  ax [options]

Options:
  --cwd <dir>,
  --cwd=<dir>       Project root to run in (defaults to the current working directory).
                    Run this from your Next.js app's root, typically as a "postbuild" script.
  --report,
  --report=<path>   Also write a machine-readable build report (entries, detected artifacts,
                    WebMCP tools, warnings, recommendations) to .ora/report.json, or to <path>.
                    Can also be set persistently via ard.config's "report".
  -h, --help        Print this help text.

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
  /** `--report` → `true` (default path); `--report=<path>` → the path; absent → undefined. */
  report?: true | string;
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
    } else if (arg === '--report') {
      parsed.report = true;
    } else if (arg.startsWith('--report=')) {
      const value = arg.slice('--report='.length);
      if (value === '') throw new CliArgError('--report= requires a path (or use bare --report)');
      parsed.report = value;
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
    stderr(`[ax] ${(err as Error).message}`);
    stderr(HELP_TEXT);
    return 1;
  }

  if (args.help) {
    stdout(HELP_TEXT);
    return 0;
  }

  // Resolve to an absolute path: a relative `--cwd` would otherwise pass `existsSync` checks
  // (resolved against the shell's process.cwd()) but fail when `config.ts` resolves the same
  // relative path via jiti against this package's own location instead.
  const cwd = resolve(args.cwd ?? io.cwd ?? process.cwd());

  const warnings: string[] = [];
  const recommendations: string[] = [];
  let generated;
  try {
    generated = await generateCatalog({
      cwd,
      onWarning: (message) => warnings.push(message),
      onRecommendation: (message) => recommendations.push(message),
    });
  } catch (err) {
    if (err instanceof ArdConfigError) {
      stderr(`[ax] ${err.message}`);
      return 1;
    }
    throw err;
  }

  const { catalog, emit, serverCard } = generated;

  for (const warning of warnings) stdout(`[ax] ⚠ ${warning}`);

  const result = writeCatalog(cwd, catalog, {
    target: emit,
    warn: (message) => stdout(`[ax] ⚠ ${message}`),
  });

  if (!result.ok) {
    stderr('[ax] Generated catalog failed spec validation — refusing to write it:');
    stderr(result.errors);
    stderr('[ax] This is a bug in ax itself, not your app. Please file an issue.');
    return 1;
  }

  stdout(`[ax] ✓ wrote ${result.path}`);
  stdout(`[ax] ✓ ${catalog.entries.length} entries referenced`);

  const { webMcpToolNames } = generated;
  if (webMcpToolNames.length > 0) {
    stdout(
      `[ax] ✓ ${webMcpToolNames.length} in-page WebMCP tool` +
        `${webMcpToolNames.length === 1 ? '' : 's'} detected (${webMcpToolNames.join(', ')})`,
    );
  }

  // Agents discover a live MCP server via the well-known server card, not the ARD catalog entry, so
  // emit it alongside the catalog when a mount was detected.
  let serverCardPath: string | undefined;
  if (serverCard) {
    const cardResult = writeServerCard(cwd, serverCard, {
      target: emit,
      warn: (message) => stdout(`[ax] ⚠ ${message}`),
    });
    serverCardPath = cardResult.path;
    stdout(`[ax] ✓ wrote ${cardResult.path} (MCP server card)`);
  }

  if (recommendations.length > 0) {
    stdout('[ax] Recommendations to improve agent-readiness:');
    for (const recommendation of recommendations) stdout(`[ax]   → ${recommendation}`);
  }

  // Machine-readable report: CLI flag wins over ard.config's `report`; both default to off. The
  // written catalog/server-card paths are patched in first, so the report also records where
  // everything landed.
  const reportTarget =
    args.report ?? (generated.reportTarget === false ? undefined : generated.reportTarget);
  if (reportTarget !== undefined) {
    generated.report.catalog.path = result.path;
    generated.report.catalog.target = result.target;
    if (serverCardPath !== undefined) generated.report.mcp.serverCardPath = serverCardPath;
    const reportPath = writeReport(cwd, generated.report, reportTarget);
    stdout(`[ax] ✓ wrote ${reportPath} (machine-readable build report)`);
  }

  return 0;
}
