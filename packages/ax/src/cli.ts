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
import { entryUrlPath } from './entries.js';
import { generateCatalog, type GenerateCatalogResult } from './generate.js';
import { runInit } from './init.js';
import type { BuildReport } from './report.js';
import { renderRouteTree } from './route-tree.js';
import { buildRouterModel } from './router-model.js';
import type { McpServerCard } from './server-card.js';
import type { AiCatalog } from './types.js';
import {
  CATALOG_OUTPUT_PATH,
  jsonText,
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

  // Machine-readable report: CLI flag wins over ax.config's `report`; both default to off. Resolved
  // up front because it also decides how chatty the terminal is — a report run records the full
  // warning and recommendation text in the file, so the log gets counts and pointers, not prose.
  const reportTarget =
    args.report ?? (generated.reportTarget === false ? undefined : generated.reportTarget);

  if (reportTarget === undefined) {
    for (const warning of warnings) stdout(`[ax] ⚠ ${warning}`);
  } else if (warnings.length > 0) {
    stdout(
      `[ax] ⚠ ${warnings.length} warning${warnings.length === 1 ? '' : 's'} — recorded in the report`,
    );
  }

  const interactive =
    io.confirm !== undefined || (process.stdout.isTTY === true && !process.env.CI);

  // MCP gating decisions live in the committed server card; a detected mount that neither the card
  // nor config covers has never been reviewed. Interactively, ask now — the answer lands in the
  // card this run writes, so the question is asked once, not per build. Headless (--yes / CI) or
  // --dry-run, warn and publish it as open (the zero-config default); the report's
  // `mcp.unreviewedMounts` carries the action item for a coding agent.
  const unreviewedMounts = generated.report.mcp.unreviewedMounts;
  if (unreviewedMounts.length > 0) {
    if (interactive && !args.yes && !args.dryRun) {
      await reviewUnreviewedMounts(cwd, generated, unreviewedMounts, io.confirm, stdout);
    } else {
      const plural = unreviewedMounts.length !== 1;
      stdout(
        `[ax] ⚠ MCP server${plural ? 's' : ''} at ${unreviewedMounts.join(', ')} ` +
          `ha${plural ? 've' : 's'} no gating decision on record — advertised as open. Run an ` +
          'interactive build (or `ax init`) to record whether login is required.',
      );
    }
  }

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

  // A first interactive run with no config at all (neither ax.config.* nor a legacy ard.config.*):
  // suggest the wizard, which wires the build and captures the judgment (siteUrl, gating, scaffolds)
  // a bare run can only leave to defaults. Suppressed under --yes: that run already consented to run
  // headless, so it doesn't need onboarding advice.
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

  // Recommendations print to the terminal only when no report is being written — a report run
  // carries every recommendation in the file the handoff line points at, so repeating the whole
  // list in the log would just be noise.
  if (recommendations.length > 0 && reportTarget === undefined) {
    stdout('[ax] Recommendations to improve agent-readiness:');
    for (const recommendation of recommendations) stdout(`[ax]   → ${recommendation}`);
  }

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
 * The review-gate gating question for mounts with no decision on record. Shows the route tree (the
 * same layout `ax init` prints — this *is* the init experience arriving late, for the user who
 * added an MCP server after setup) and asks per server, since auth is declared per server in the
 * MCP conventions. A "requires login" answer is applied to this run's artifacts via
 * `markMountGated`; either answer is persisted by the server card written right after, so the
 * question never repeats — unless no single card can be written (several mounts), in which case
 * the mounts stay listed as unreviewed in the report.
 */
async function reviewUnreviewedMounts(
  cwd: string,
  generated: GenerateCatalogResult,
  unreviewedMounts: string[],
  injectedConfirm: ((question: string) => Promise<boolean>) | undefined,
  stdout: (line: string) => void,
): Promise<void> {
  const confirm = injectedConfirm ?? defaultConfirm;
  const plural = unreviewedMounts.length !== 1;
  stdout(
    `[ax] Detected ${plural ? '' : 'an '}MCP server${plural ? 's' : ''} with no gating decision ` +
      'on record:',
  );
  stdout('[ax]');
  const router = buildRouterModel(cwd);
  const apiRoutePaths = [
    ...new Set(
      router
        .listApiEndpoints()
        .map((endpoint) => endpoint.url)
        .filter((url): url is string => url !== undefined),
    ),
  ].sort();
  const lines = renderRouteTree({
    routers: generated.report.routers,
    pageRoutes: router.listPageRoutes(),
    // Plain API routes are agent-usable only when an OpenAPI doc describes them; without one they
    // would just be noise in the tree.
    apiRoutePaths: generated.report.artifacts.openapi.found ? apiRoutePaths : [],
    basePath: generated.report.basePath,
    mounts: generated.report.mcp.mounts.map((mount) => ({
      pathname: mount.pathname,
      tools: mount.tools,
    })),
  });
  for (const line of lines) stdout(`[ax] ${line}`.trimEnd());
  stdout('[ax]');

  for (const path of unreviewedMounts) {
    const isPublic = await confirm(
      `Is the MCP server at ${path} public — agents can use it without logging in?`,
    );
    if (!isPublic) markMountGated(generated, path);
  }

  // The card written below records the answers, so these mounts are reviewed from the next build
  // on. With no single card to write (several mounts), the decisions apply this run only and the
  // report keeps carrying the mounts as unreviewed.
  if (generated.serverCard !== undefined) generated.report.mcp.unreviewedMounts = [];
}

/**
 * Applies a "requires login" answer from the review gate to this run's artifacts: the catalog
 * entry gets the secret-free auth descriptor and the server card the `authentication` block — the
 * same shape a detected `withMcpAuth` wrapper or a recorded card would have produced. The card
 * write is what persists the decision.
 */
function markMountGated(generated: GenerateCatalogResult, path: string): void {
  const { serverCard } = generated;
  const cardMountPath =
    serverCard !== undefined ? new URL(serverCard.serverUrl).pathname : undefined;
  if (serverCard !== undefined && cardMountPath === path) {
    serverCard.authentication = { required: true };
  }
  for (const entry of generated.catalog.entries) {
    if (entry.type !== 'application/mcp-server-card+json') continue;
    const entryPath = entryUrlPath(entry);
    // A single-mount entry references the card (not the mount), so match either identity.
    const referencesCard =
      cardMountPath === path && entryPath !== undefined && entryPath.endsWith('/server-card.json');
    if (entryPath === path || referencesCard) entry.auth = { status: 'unknown' };
  }
}

/**
 * The handoff footer: where the report landed and what to do with it. Deliberately two plain
 * lines — the report itself carries the full recommendation detail, so the log only points at it.
 * Printed only when something is still actionable: a build with nothing left to do doesn't need a
 * to-do list.
 */
function printAgentHandoff(
  report: BuildReport,
  reportPath: string | undefined,
  stdout: (line: string) => void,
): void {
  if (!report.ora.checks.some((check) => check.status === 'actionable')) return;

  if (reportPath === undefined) {
    stdout(
      '[ax] Tip: re-run with --report to write a machine-readable report your coding agent can work from.',
    );
    return;
  }
  stdout(`[ax] Find your report at: ${reportPath}`);
  stdout(
    '[ax]   Tip: hand your coding agent the report and see if there are any artifacts you can ' +
      'create to improve agent readiness.',
  );
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
 * before it's written (and before the confirmation gate). One short line per entry — a friendly
 * name, where it points, and whether it requires auth (the point of the gating work: a gated
 * surface reads as gated rather than silently open). The MCP entry folds its server card in: one
 * line naming the card and pointing at the server it describes, not the URN + media type + card
 * URL spelled out. Purely informational; it never decides anything.
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
    const isMcp = entry.type === 'application/mcp-server-card+json';
    const label =
      isMcp && generated.serverCard !== undefined
        ? 'MCP server card'
        : (entry.displayName ?? entry.identifier);
    const where =
      isMcp && generated.serverCard !== undefined
        ? generated.serverCard.serverUrl
        : typeof entry.url === 'string'
          ? entry.url
          : '(inline data)';
    const auth = entry.auth !== undefined && entry.auth.status !== 'none' ? ' (requires auth)' : '';
    stdout(`[ax]   • ${label} → ${where}${auth}`);
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
