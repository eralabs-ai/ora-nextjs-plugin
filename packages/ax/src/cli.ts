import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  type ArtifactSize,
  exceedsTruncationLimit,
  formatArtifactSize,
  formatTokens,
  measureArtifact,
  measureContent,
} from './artifact-size.js';
import { AxConfigError, findExistingConfig } from './config.js';
import { generateCatalog, type GenerateCatalogResult } from './generate.js';
import { runInit } from './init.js';
import { ORA_SCAN_API, ORA_SKILL_MCP_URL } from './ora-checks.js';
import type { BuildReport } from './report.js';
import type { McpServerCard } from './server-card.js';
import type { AiCatalog } from './types.js';
import {
  CATALOG_OUTPUT_PATH,
  jsonText,
  REPORT_OUTPUT_PATH,
  writeCatalog,
  writeReport,
  writeServerCard,
} from './write.js';

const HELP_TEXT = `ax — generate a spec-valid ai-catalog.json at build time

Usage:
  ax [options]
  ax init [options]   First-time setup: detect your app, write ax.config, wire "postbuild": "ax".
                      Run \`ax init --help\` for its options.

Options:
  --cwd <dir>,
  --cwd=<dir>       Project root to run in (defaults to the current working directory).
                    Run this from your Next.js app's root, typically as a "postbuild" script.
  --report,
  --report=<path>   Also write a machine-readable build report (entries, detected artifacts,
                    WebMCP tools, warnings, recommendations) to .ora/report.json, or to <path>.
                    Can also be set persistently via ax.config's "report".
  --yes, -y         Skip the confirmation prompt before publishing a new catalog. Required to
                    write in CI / non-interactive shells (see the exposure summary below).
  --dry-run         Print the exposure summary and exit without writing anything.
  -h, --help        Print this help text.

Writes public/.well-known/ai-catalog.json. Validates the generated catalog against the AI Catalog
spec before writing; refuses to write (and exits non-zero) if it doesn't validate.
`;

export interface CliIO {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /**
   * How to ask for interactive confirmation before publishing a new catalog. Injected so the gate
   * is testable; in real use it's a readline y/N prompt (see `defaultConfirm`). Its presence also
   * marks the run as interactive, so a test can exercise the confirm/decline paths without a TTY.
   */
  confirm?: (question: string) => Promise<boolean>;
}

interface ParsedArgs {
  help: boolean;
  cwd?: string;
  /** `--report` → `true` (default path); `--report=<path>` → the path; absent → undefined. */
  report?: true | string;
  /** `--yes`/`-y`: skip the publish confirmation (required in CI). */
  yes: boolean;
  /** `--dry-run`: print the exposure summary and write nothing. */
  dryRun: boolean;
}

class CliArgError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false, yes: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    } else if (arg === '--yes' || arg === '-y') {
      parsed.yes = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
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

  // `ax init` is the onboarding wizard — a distinct subcommand with its own arg surface. Bare `ax`
  // (and every existing flag) is unchanged; an unknown subcommand still errors below as before.
  if (argv[0] === 'init') {
    const initIo: { cwd?: string; stdout: (l: string) => void; stderr: (l: string) => void } = {
      stdout,
      stderr,
    };
    if (io.cwd !== undefined) initIo.cwd = io.cwd;
    return runInit(argv.slice(1), initIo);
  }

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

  // Review before publish: show the full surface this run would expose, then gate the first
  // publish. A catalog already committed at the target path means this isn't a first run, so
  // re-runs stay unattended; a fresh publish must be confirmed — interactively, or with --yes
  // (required, and the norm, in CI). This is the backstop the auth/gating work relies on: the last
  // chance to catch a surface that shouldn't be public before it's written.
  printExposureSummary(catalog, generated, stdout);

  if (args.dryRun) {
    stdout('[ax] --dry-run: nothing written.');
    return 0;
  }

  const firstPublish = !existsSync(join(cwd, CATALOG_OUTPUT_PATH));
  const interactive =
    io.confirm !== undefined || (process.stdout.isTTY === true && !process.env.CI);

  // A first interactive run with no ax.config.* at all: suggest the wizard, which wires the build
  // and captures the judgment (siteUrl, gating, scaffolds) a bare run can only leave to defaults.
  // Suppressed under --yes: that run already consented to run headless, so it doesn't need
  // onboarding advice.
  if (firstPublish && interactive && !args.yes && findExistingConfig(cwd) === undefined) {
    stdout('[ax] Tip: run `ax init` to set up ax.config and wire your postbuild in one step.');
  }

  if (firstPublish && !args.yes) {
    if (!interactive) {
      stderr(
        '[ax] This run would publish a new ai-catalog.json exposing the surface above. Re-run ' +
          'with --yes to confirm (required in CI / non-interactive shells).',
      );
      return 1;
    }
    const confirm = io.confirm ?? defaultConfirm;
    if (!(await confirm('Publish this catalog?'))) {
      stdout('[ax] Aborted — nothing written.');
      return 1;
    }
  }

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
  const warningSuffix =
    warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '';
  stdout(
    `[ax] ✓ ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} referenced${warningSuffix}`,
  );

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

  // Token-aware sizes: report each artifact this build wrote in bytes *and* estimated tokens
  // (chars ÷ 4), since tokens — not disk size — are what constrain the agent that later reads it.
  // Measured off the *served* content (the JSON/markdown an agent fetches), not the file on disk,
  // so a 'route' emission target's JS wrapper never inflates the numbers or trips the size warning.
  const sizes = measureGeneratedArtifacts(cwd, {
    catalog,
    catalogPath: result.path,
    serverCard: generated.serverCard,
    serverCardPath,
    llmsTxtBody: generated.scaffoldedLlmsTxtBody,
    report: generated.report,
  });
  generated.report.sizes = sizes;
  if (sizes.length > 0) {
    stdout('[ax] Generated artifact sizes (estimated tokens = chars ÷ 4):');
    for (const size of sizes) stdout(`[ax]   • ${size.path} — ${formatArtifactSize(size)}`);
    for (const size of sizes) {
      if (exceedsTruncationLimit(size.chars)) {
        stdout(
          `[ax] ⚠ ${size.path} is ${size.chars.toLocaleString()} chars (${formatTokens(size.tokens)}) — ` +
            'Claude Code truncates responses over 100K chars.',
        );
      }
    }
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

interface MeasureArtifactsInput {
  catalog: AiCatalog;
  /** Absolute path the catalog was written to (a static file or a route handler). */
  catalogPath: string;
  serverCard: McpServerCard | undefined;
  /** Absolute path the server card was written to, if one was written. */
  serverCardPath: string | undefined;
  /** The markdown body a scaffolded llms.txt serves, if one was scaffolded this run. */
  llmsTxtBody: string | undefined;
  report: BuildReport;
}

/**
 * Measures every artifact this build wrote, in the units that constrain the agent that reads it.
 *
 * The catalog, server card, and scaffolded llms.txt are sized from their *served* content (the
 * JSON/markdown an agent fetches), not the file on disk — for a `'route'` emission target the file
 * is a JS wrapper around the payload, so measuring the file would inflate the numbers and could trip
 * the truncation warning on a response that's actually well within the limit. Content-served-verbatim
 * scaffolds (a `created`/`appended` robots.txt, a `created` JSON-LD component) are measured from the
 * file, since there the file is what ships. A scaffold left unchanged or skipped isn't this build's
 * output, so it isn't measured.
 */
function measureGeneratedArtifacts(cwd: string, input: MeasureArtifactsInput): ArtifactSize[] {
  const { scaffolds } = input.report;
  const robots = scaffolds.robotsTxt;
  const jsonLd = scaffolds.jsonLd;
  const sizes: ArtifactSize[] = [];

  // Served-content artifacts: measured from the payload, so the numbers match the HTTP response.
  sizes.push(
    measureContent(jsonText(input.catalog), 'ai-catalog.json', relative(cwd, input.catalogPath)),
  );
  if (input.serverCard !== undefined && input.serverCardPath !== undefined) {
    sizes.push(
      measureContent(
        jsonText(input.serverCard),
        'mcp-server-card',
        relative(cwd, input.serverCardPath),
      ),
    );
  }
  if (input.llmsTxtBody !== undefined && scaffolds.llmsTxt?.path !== undefined) {
    sizes.push(
      measureContent(input.llmsTxtBody, 'llms.txt', relative(cwd, scaffolds.llmsTxt.path)),
    );
  }

  // Served-verbatim files: the file on disk is exactly what ships, so measure it directly.
  const fileTargets: Array<{ artifact: string; path: string | undefined }> = [
    {
      artifact: 'robots.txt',
      path: robots?.action === 'created' || robots?.action === 'appended' ? robots.path : undefined,
    },
    {
      artifact: 'organization-json-ld',
      path: jsonLd?.action === 'created' ? jsonLd.path : undefined,
    },
  ];
  for (const target of fileTargets) {
    if (target.path === undefined) continue;
    const size = measureArtifact(cwd, target.path, target.artifact);
    if (size !== undefined) sizes.push(size);
  }

  return sizes;
}

/**
 * The "about to expose" summary: every artifact this run would publish, so the surface is visible
 * before it's written (and before the confirmation gate). Each entry shows its identifier, type,
 * where it points, and — the point of the auth work — whether it carries an auth descriptor, so a
 * gated surface reads as gated rather than silently open. Purely informational; it never decides
 * anything.
 */
function printExposureSummary(
  catalog: AiCatalog,
  generated: GenerateCatalogResult,
  stdout: (line: string) => void,
): void {
  const { entries } = catalog;
  stdout(
    `[ax] About to expose ${entries.length} catalog ${entries.length === 1 ? 'entry' : 'entries'}:`,
  );
  for (const entry of entries) {
    const where = typeof entry.url === 'string' ? entry.url : '(inline data)';
    const auth = entry.auth ? ` [auth: ${entry.auth.status}]` : '';
    stdout(`[ax]   • ${entry.identifier} (${entry.type}) → ${where}${auth}`);
  }
  if (generated.serverCard) {
    const gated = generated.serverCard.authentication ? ' (gated)' : '';
    stdout(`[ax]   • MCP server card → ${generated.serverCard.serverUrl}${gated}`);
  }
}

/**
 * The real interactive confirmation: a readline y/N prompt on the current TTY. Loaded lazily and
 * only reached on a genuinely interactive run (tests inject `io.confirm` instead), so the readline
 * import never runs in CI. Anything other than an explicit yes is treated as "no".
 */
async function defaultConfirm(question: string): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
