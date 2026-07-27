import { resolve } from 'node:path';

import { AxConfigError } from './config.js';
import { generateCatalog } from './generate.js';
import { ORA_SCAN_API, ORA_SKILL_MCP_URL } from './ora-checks.js';
import type { BuildReport } from './report.js';
import { REPORT_OUTPUT_PATH, writeCatalog, writeReport, writeServerCard } from './write.js';

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
                    Can also be set persistently via ax.config's "report".
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
 * modes (bad args, invalid catalog, invalid `ax.config`) — those are reported via `stderr` and a
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
    if (err instanceof AxConfigError) {
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
  const entryCount = catalog.entries.length;
  stdout(`[ax] ✓ ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} referenced`);

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

  // Machine-readable report: CLI flag wins over ax.config's `report`; both default to off. The
  // written catalog/server-card paths are patched in first, so the report also records where
  // everything landed.
  const reportTarget =
    args.report ?? (generated.reportTarget === false ? undefined : generated.reportTarget);
  let reportPath: string | undefined;
  if (reportTarget !== undefined) {
    generated.report.catalog.path = result.path;
    generated.report.catalog.target = result.target;
    if (serverCardPath !== undefined) generated.report.mcp.serverCardPath = serverCardPath;
    reportPath = writeReport(cwd, generated.report, reportTarget);
    stdout(`[ax] ✓ wrote ${reportPath} (machine-readable build report)`);
  }

  printAgentHandoff(generated.report, reportPath, stdout);
  return 0;
}

/**
 * The handoff footer. Everything above it is a person reading a build log; this is the pointer for
 * the coding agent that picks up the remaining work — the report that maps each recommendation to
 * an Ora check, the skill server that explains how to close them, and the scan that verifies the
 * result against the deployed site. Printed only when something is still actionable: a build with
 * nothing left to do doesn't need a to-do list.
 */
function printAgentHandoff(
  report: BuildReport,
  reportPath: string | undefined,
  stdout: (line: string) => void,
): void {
  if (!report.ora.checks.some((check) => check.status === 'actionable')) return;

  const location =
    reportPath ?? `${REPORT_OUTPUT_PATH} (not written this run — re-run with --report)`;
  const domain = report.siteUrl ?? 'https://<your-domain>';

  stdout(
    `[ax] Agent handoff: ${location} maps every recommendation to Ora's agent-readiness checks.`,
  );
  stdout(
    `[ax]   Point your coding agent at it and connect Ora's skill server (MCP): ${ORA_SKILL_MCP_URL}`,
  );
  stdout(`[ax]   Then scan your deployed site: ${ORA_SCAN_API.scan} {"url": "${domain}"}`);
}
