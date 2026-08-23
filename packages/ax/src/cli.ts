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
import { applyAuthMdPlan, type ApplyAuthMdResult } from './auth-md.js';
import { AxConfigError, findExistingConfig } from './config.js';
import { entryUrlPath } from './entries.js';
import { type FileTreeEntry, renderFileTree } from './file-tree.js';
import { generateCatalog, type GenerateCatalogResult } from './generate.js';
import { runInit } from './init.js';
import { refreshServingManifestIfPresent, writeServingManifest } from './manifest.js';
import { applyMarkdownTwinPlan, type ApplyTwinPlanResult } from './markdown-twins.js';
import type { BuildReport } from './report.js';
import { renderRouteTree } from './route-tree.js';
import { buildRouterModel } from './router-model.js';
import type { McpServerCardEmission, McpServerCardPlan } from './server-card.js';
import { buildArtifactUrl, servedPath } from './site-url.js';
import type { AiCatalog } from './types.js';
import {
  CATALOG_OUTPUT_PATH,
  jsonText,
  namedServerCardUrlPath,
  writeCatalog,
  writeReport,
  writeServerCards,
} from './write.js';

const HELP_TEXT = `ax — generate a spec-valid ai-catalog.json at build time

Usage:
  ax [options]
  ax init [options]   First-time setup: detect your app, write ax.config, wire "postbuild": "ax".
                      Run \`ax init --help\` for its options.
  ax manifest [--cwd <dir>]
                      Regenerate the serving-manifest data module (ax-manifest.ts) your middleware
                      imports. Source-tree-only and fast — wire it as "prebuild" so the manifest is
                      fresh before next build compiles your middleware.

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

  // `ax manifest` — the fast prebuild half of the twin/middleware story: middleware.ts is compiled
  // *during* next build, so the manifest module it imports must be regenerated *before* the build;
  // everything the manifest records is source-tree-derived, so this needs no build output.
  if (argv[0] === 'manifest') {
    return runManifestCommand(argv.slice(1), io, stdout, stderr);
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

  const { catalog, emit, serverCardPlan } = generated;

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

  // MCP gating and primary-server decisions live in the committed server cards; a detected mount
  // that neither a card nor config covers has never been reviewed, and with several mounts the
  // root card's owner is a judgment call too. Interactively, ask now — the answers land in the
  // cards this run writes, so the questions are asked once, not per build. Headless (--yes / CI)
  // or --dry-run, warn and apply the defaults (open, public server primary); the report's
  // `mcp.unreviewedMounts` / `mcp.primaryUnreviewed` carry the action items for a coding agent.
  const unreviewedMounts = generated.report.mcp.unreviewedMounts;
  const primaryUnreviewed = generated.report.mcp.primaryUnreviewed === true;
  if (unreviewedMounts.length > 0 || primaryUnreviewed) {
    if (interactive && !args.yes && !args.dryRun) {
      await reviewMcpDecisions(cwd, generated, unreviewedMounts, io.confirm, stdout);
    } else {
      if (unreviewedMounts.length > 0) {
        const plural = unreviewedMounts.length !== 1;
        stdout(
          `[ax] ⚠ MCP server${plural ? 's' : ''} at ${unreviewedMounts.join(', ')} ` +
            `ha${plural ? 've' : 's'} no gating decision on record — advertised as open. Run an ` +
            'interactive build (or `ax init`) to record whether login is required.',
        );
      }
      if (primaryUnreviewed && generated.report.mcp.primaryMount !== undefined) {
        stdout(
          `[ax] ⚠ ${generated.report.mcp.mounts.length} MCP servers but no primary on record — ` +
            `the root server card defaults to ` +
            `${servedPath(generated.report.basePath, generated.report.mcp.primaryMount)}. Run an ` +
            'interactive build (or `ax init`) to choose a different primary.',
        );
      }
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
  // Twins are default-on, so their *first* write is gated even when the catalog isn't new (e.g.
  // upgrading ax on an already-published site): the summary above listed them, and the same
  // confirmation covers them. Re-runs with twins already on disk stay unattended.
  const firstTwinPublish =
    generated.twinPlan.writes.length > 0 && !generated.twinPlan.hasExistingGenerated;

  // A first interactive run with no config at all (neither ax.config.* nor a legacy ard.config.*):
  // suggest the wizard, which wires the build and captures the judgment (siteUrl, gating, scaffolds)
  // a bare run can only leave to defaults. Suppressed under --yes: that run already consented to run
  // headless, so it doesn't need onboarding advice.
  if (firstPublish && interactive && !args.yes && findExistingConfig(cwd) === undefined) {
    stdout('[ax] Tip: run `ax init` to set up ax.config and wire your postbuild in one step.');
  }

  if ((firstPublish || firstTwinPublish) && !args.yes) {
    const what = firstPublish
      ? 'a new ai-catalog.json exposing the surface above'
      : 'markdown twins for the pages above (a new public surface)';
    if (!interactive) {
      stderr(
        `[ax] This run would publish ${what}. Re-run with --yes to confirm (required in CI / ` +
          'non-interactive shells).',
      );
      return 1;
    }
    const confirm = io.confirm ?? defaultConfirm;
    const question = firstPublish ? 'Publish this catalog?' : 'Publish these markdown twins?';
    if (!(await confirm(question))) {
      stdout('[ax] Aborted — nothing written.');
      return 1;
    }
    // Separate the y/N answer from the output block that follows so they don't run together.
    stdout('[ax]');
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

  // Everything this run writes is collected into one file tree printed near the end, rather than a
  // "✓ wrote <path>" line per artifact. `writeNotes` holds each artifact's *non-size* annotation
  // keyed by its cwd-relative path (the same key `sizes` uses), so the size measured later and the
  // note collected here join by path when the tree is built.
  const writeNotes = new Map<string, string>();
  const entryCount = catalog.entries.length;
  writeNotes.set(
    relative(cwd, result.path),
    `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`,
  );

  // The catalog headline stays a standalone line before the tree: entry and warning counts are the
  // build's top-level result, not a per-file detail.
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

  // Agents discover a live MCP server via the well-known server cards, not the ARD catalog
  // entries, so emit them alongside the catalog when mounts were detected: the primary server's
  // card at the root path, and — for a multi-server host — every server's card at its named slot.
  let serverCardPath: string | undefined;
  const namedServerCards: Array<{ mount: string; path: string }> = [];
  const writtenCards: Array<{ emission: McpServerCardEmission; path: string }> = [];
  if (serverCardPlan) {
    const cardResult = writeServerCards(cwd, serverCardPlan, {
      target: emit,
      warn: (message) => stdout(`[ax] ⚠ ${message}`),
    });
    serverCardPath = cardResult.rootPath;
    const primary = serverCardPlan.cards.find((emission) => emission.primary);
    if (primary !== undefined) writtenCards.push({ emission: primary, path: cardResult.rootPath });
    // The card writes go into the file tree; record only their notes here (primary path for the
    // root card of a multi-server host, "requires auth" for any gated card).
    const rootNoteParts: string[] = [];
    if (serverCardPlan.multi && primary !== undefined) {
      rootNoteParts.push(
        `primary: ${servedPath(generated.report.basePath, primary.mountPathname)}`,
      );
    }
    if (primary?.card.authentication !== undefined) rootNoteParts.push('requires auth');
    if (rootNoteParts.length > 0) {
      writeNotes.set(relative(cwd, cardResult.rootPath), rootNoteParts.join(' · '));
    }
    cardResult.named.forEach((named, index) => {
      const emission = serverCardPlan.cards[index];
      if (emission !== undefined) {
        namedServerCards.push({ mount: emission.mountPathname, path: named.path });
        writtenCards.push({ emission, path: named.path });
        if (emission.card.authentication !== undefined) {
          writeNotes.set(relative(cwd, named.path), 'requires auth');
        }
      }
    });
    for (const removed of cardResult.removed) {
      stdout(`[ax] ✓ removed ${relative(cwd, removed)} (stale MCP server card)`);
    }
  }

  // Markdown twins + the auth guide: planned during generation, applied only now — after the
  // review gate — so nothing lands in public/ the summary didn't show. When the feature is off,
  // nothing is touched at all (including previously generated files: turning it off is the user's
  // call; deleting their public/ contents on that signal is not ours to make silently).
  const twinWarn = (message: string): void => stdout(`[ax] ⚠ ${message}`);
  const twinResult = generated.twinPlan.enabled
    ? applyMarkdownTwinPlan(cwd, generated.twinPlan, twinWarn)
    : { written: [], deleted: [] };
  const authMdResult = generated.twinPlan.enabled
    ? applyAuthMdPlan(cwd, generated.authMdPlan, twinWarn)
    : {};
  reportMarkdownTwinOutcome(cwd, generated, twinResult, authMdResult, reportTarget, stdout);

  // Token-aware sizes: report each artifact this build wrote in bytes *and* estimated tokens
  // (chars ÷ 4), since tokens — not disk size — are what constrain the agent that later reads it.
  // Measured off the *served* content (the JSON/markdown an agent fetches), not the file on disk,
  // so a 'route' emission target's JS wrapper never inflates the numbers or trips the size warning.
  const sizes = measureGeneratedArtifacts(cwd, {
    catalog,
    catalogPath: result.path,
    serverCards: writtenCards.map(({ emission, path }) => ({ card: emission.card, path })),
    llmsTxtBody: generated.scaffoldedLlmsTxtBody,
    report: generated.report,
  });
  // Twins and the auth guide are served verbatim as written, so their in-memory content is exactly
  // the response an agent fetches.
  for (const twin of twinResult.written) {
    sizes.push(measureContent(twin.content, 'markdown-twin', relative(cwd, twin.filePath)));
  }
  if (authMdResult.written !== undefined && generated.authMdPlan !== undefined) {
    sizes.push(measureContent(generated.authMdPlan.content, 'auth.md', authMdResult.written));
  }
  generated.report.sizes = sizes;

  // Recommendations print to the terminal only when no report is being written — a report run
  // carries every recommendation in the file the handoff line points at, so repeating the whole
  // list in the log would just be noise.
  if (recommendations.length > 0 && reportTarget === undefined) {
    stdout('[ax] Recommendations to improve agent-readiness:');
    for (const recommendation of recommendations) stdout(`[ax]   → ${recommendation}`);
  }

  // Keep an existing serving-manifest module fresh: the twins just written are part of what it
  // records. Refresh-if-present only — a build never introduces a new source-tree file silently;
  // creating the module is `ax manifest`'s (or the wizard's prebuild wiring's) job.
  const manifestResult = await refreshServingManifestIfPresent(cwd, (message) =>
    stdout(`[ax] ⚠ ${message}`),
  );
  if (manifestResult !== undefined) {
    writeNotes.set(relative(cwd, manifestResult.path), 'serving manifest (refreshed)');
  }

  let reportPath: string | undefined;
  if (reportTarget !== undefined) {
    generated.report.catalog.path = result.path;
    generated.report.catalog.target = result.target;
    if (serverCardPath !== undefined) generated.report.mcp.serverCardPath = serverCardPath;
    if (namedServerCards.length > 0) generated.report.mcp.serverCards = namedServerCards;
    reportPath = writeReport(cwd, generated.report, reportTarget);
    writeNotes.set(relative(cwd, reportPath), 'machine-readable build report');
  }

  // One consolidated file tree of everything this run wrote, in place of a "✓ wrote" line per
  // artifact. Each measured artifact contributes a `<size>` annotation joined to any note collected
  // for its path (entry count, primary/auth, "refreshed"…); note-only artifacts with no measured
  // size (the manifest refresh, the report) are appended after.
  const treeEntries: FileTreeEntry[] = [];
  const measuredPaths = new Set<string>();
  for (const size of sizes) {
    const note = writeNotes.get(size.path);
    const annotation =
      note !== undefined ? `${formatArtifactSize(size)} · ${note}` : formatArtifactSize(size);
    treeEntries.push({ path: size.path, annotation });
    measuredPaths.add(size.path);
  }
  for (const [path, note] of writeNotes) {
    if (!measuredPaths.has(path)) treeEntries.push({ path, annotation: note });
  }
  if (treeEntries.length > 0) {
    stdout('[ax] ✓ wrote (sizes show estimated tokens, chars ÷ 4):');
    for (const line of renderFileTree(treeEntries)) stdout(`[ax]   ${line}`.trimEnd());
  }

  // Oversize warnings print after the tree so they don't break its layout: an artifact an agent is
  // meant to read whole is useless past the truncation limit, so this stays a loud, separate line.
  for (const size of sizes) {
    if (exceedsTruncationLimit(size.chars)) {
      stdout(
        `[ax] ⚠ ${size.path} is ${size.chars.toLocaleString()} chars (${formatTokens(size.tokens)}) — ` +
          'Claude Code truncates responses over 100K chars.',
      );
    }
  }

  printAgentHandoff(generated.report, reportPath, stdout);
  return 0;
}

/**
 * The review-gate questions for MCP decisions with nothing on record: per-server gating (auth is
 * declared per server in the MCP conventions), then — with several mounts — which server is
 * primary. Shows the route tree (the same layout `ax init` prints — this *is* the init experience
 * arriving late, for the user who added an MCP server after setup). A "requires login" answer is
 * applied to this run's artifacts via `markMountGated`, a primary answer via
 * `applyPrimaryChoice`; every answer is persisted by the server cards written right after, so the
 * questions never repeat.
 */
async function reviewMcpDecisions(
  cwd: string,
  generated: GenerateCatalogResult,
  unreviewedMounts: string[],
  injectedConfirm: ((question: string) => Promise<boolean>) | undefined,
  stdout: (line: string) => void,
): Promise<void> {
  const confirm = injectedConfirm ?? defaultConfirm;
  const plural = generated.report.mcp.mounts.length !== 1;
  stdout(
    `[ax] Detected ${plural ? '' : 'an '}MCP server${plural ? 's' : ''} with ` +
      `${unreviewedMounts.length > 0 ? 'no gating decision' : 'no primary'} on record:`,
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

  // The primary decision runs after gating so it can honor the answers just given. Exactly one
  // public server is no judgment call — the root well-known path is probed blind by registries,
  // so the one server usable without credentials is its only sensible owner, applied silently.
  // Only the ambiguous cases (several public servers, or none) get asked: one y/N per candidate,
  // public servers first, stopping at the first yes; declining every candidate keeps the default.
  const plan = generated.serverCardPlan;
  if (generated.report.mcp.primaryUnreviewed === true && plan !== undefined && plan.multi) {
    const basePath = generated.report.basePath;
    const publicCards = plan.cards.filter((card) => card.card.authentication === undefined);
    if (publicCards.length === 1 && publicCards[0] !== undefined) {
      applyPrimaryChoice(generated, publicCards[0].mountPathname);
    } else {
      const candidates = [...plan.cards].sort(
        (a, b) =>
          Number(a.card.authentication !== undefined) - Number(b.card.authentication !== undefined),
      );
      for (const candidate of candidates) {
        const served = servedPath(basePath, candidate.mountPathname);
        const chosen = await confirm(
          `Should the MCP server at ${served} be the primary (the path agents probe first)?`,
        );
        if (chosen) {
          applyPrimaryChoice(generated, candidate.mountPathname);
          break;
        }
      }
    }
    const primary = plan.cards.find((emission) => emission.primary);
    if (primary !== undefined) {
      generated.report.mcp.primaryMount = primary.mountPathname;
      stdout(
        `[ax]   Primary MCP server: ${servedPath(basePath, primary.mountPathname)} — recorded ` +
          'in the root server card.',
      );
    }
  }

  // The cards written below record the answers, so these decisions are on record from the next
  // build on.
  if (generated.serverCardPlan !== undefined) {
    generated.report.mcp.unreviewedMounts = [];
    delete generated.report.mcp.primaryUnreviewed;
  }
}

/**
 * Applies a "requires login" answer from the review gate to this run's artifacts: the catalog
 * entry gets the secret-free auth descriptor and the mount's server card the `authentication`
 * block — the same shape a detected `withMcpAuth` wrapper or a recorded card would have produced.
 * The card write is what persists the decision.
 */
function markMountGated(generated: GenerateCatalogResult, path: string): void {
  const basePath = generated.report.basePath;
  const emission = generated.serverCardPlan?.cards.find(
    (candidate) => servedPath(basePath, candidate.mountPathname) === path,
  );
  if (emission !== undefined) emission.card.authentication = { required: true };
  for (const entry of generated.catalog.entries) {
    if (entry.type !== 'application/mcp-server-card+json') continue;
    const entryPath = entryUrlPath(entry);
    // The mount's entry references its card (not the mount), so match either identity.
    const referencesCard =
      emission !== undefined &&
      entry.url === cardUrlFor(generated, emission) &&
      entryPath !== undefined;
    if (entryPath === path || entry.url === emission?.card.serverUrl || referencesCard) {
      entry.auth = { status: 'unknown' };
    }
  }
}

/** The absolute URL an emission's card is served at (root for the primary, named slot otherwise). */
function cardUrlFor(
  generated: GenerateCatalogResult,
  emission: McpServerCardEmission,
): string | undefined {
  const siteUrl = generated.report.siteUrl;
  if (siteUrl === undefined) return undefined;
  const cardPath = emission.primary
    ? '/.well-known/mcp/server-card.json'
    : namedServerCardUrlPath(emission.serverName);
  return buildArtifactUrl(siteUrl, generated.report.basePath, cardPath);
}

/**
 * Applies a primary answer from the review gate: the chosen mount's card takes the root
 * well-known path and every catalog entry is re-pointed at the card URL its mount now serves
 * from. The root card written right after is what persists the choice.
 */
function applyPrimaryChoice(generated: GenerateCatalogResult, pathname: string): void {
  const plan = generated.serverCardPlan;
  if (plan === undefined || !plan.cards.some((card) => card.mountPathname === pathname)) return;

  // Capture each entry's current card URL before flipping, so entries can be re-pointed even
  // though the generate-time rewrite already replaced their mount URLs.
  const previousUrls = new Map(
    plan.cards.map((emission) => [emission.mountPathname, cardUrlFor(generated, emission)]),
  );
  for (const emission of plan.cards) emission.primary = emission.mountPathname === pathname;
  plan.cards.sort((a, b) => Number(b.primary) - Number(a.primary));

  // One pass over the entries, matching against each entry's *original* URL: the root URL just
  // changed owner, so rewriting per-card sequentially could re-rewrite an entry already moved
  // onto the root path.
  const rewrites = plan.cards.map((emission) => ({
    previous: previousUrls.get(emission.mountPathname),
    next: cardUrlFor(generated, emission),
  }));
  for (const entry of generated.catalog.entries) {
    if (entry.type !== 'application/mcp-server-card+json') continue;
    const rewrite = rewrites.find(
      (candidate) => candidate.previous !== undefined && candidate.previous === entry.url,
    );
    if (rewrite?.next !== undefined) entry.url = rewrite.next;
  }
}

/**
 * The handoff footer: where the report landed and what to do with it. The prompt is the one line
 * users are meant to *act* on (paste it into their coding agent), so it's set apart with blank
 * lines and a 📋 marker instead of blending into the build log; the report itself carries the full
 * recommendation detail, so the log only points at it. Printed only when something is still
 * actionable: a build with nothing left to do doesn't need a to-do list.
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
  stdout('[ax]');
  stdout(`[ax] Find your report at: ${reportPath}`);
  stdout('[ax] 📋 Copy this prompt to your coding agent:');
  stdout('[ax]');
  stdout(
    `[ax]   Read ${reportPath} and work through every check marked "actionable": create or ` +
      'improve those artifacts to make this site more agent-ready (each check may carry a note ' +
      'with the exact next step, and the markdownTwins.skipped section lists why any route has ' +
      'no markdown twin), then rebuild and confirm the report marks them addressed.',
  );
  stdout('[ax]');
}

interface MeasureArtifactsInput {
  catalog: AiCatalog;
  /** Absolute path the catalog was written to (a static file or a route handler). */
  catalogPath: string;
  /** Every server card written this run (root + named), with where each landed. */
  serverCards: Array<{ card: McpServerCardEmission['card']; path: string }>;
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
  for (const { card, path } of input.serverCards) {
    sizes.push(measureContent(jsonText(card), 'mcp-server-card', relative(cwd, path)));
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
  // Card lookup by every URL an mcp entry might carry (the mount's endpoint, or the card URL the
  // generate-time rewrite pointed it at), so each card gets its one line whatever the entry shows.
  const plan = generated.serverCardPlan;
  const cardByUrl = new Map<string, McpServerCardEmission>();
  for (const emission of plan?.cards ?? []) {
    cardByUrl.set(emission.card.serverUrl, emission);
    const cardUrl = cardUrlFor(generated, emission);
    if (cardUrl !== undefined) cardByUrl.set(cardUrl, emission);
  }
  for (const entry of entries) {
    const emission =
      entry.type === 'application/mcp-server-card+json' && typeof entry.url === 'string'
        ? cardByUrl.get(entry.url)
        : undefined;
    const label =
      emission !== undefined ? 'MCP server card' : (entry.displayName ?? entry.identifier);
    const where =
      emission !== undefined
        ? emission.card.serverUrl
        : typeof entry.url === 'string'
          ? entry.url
          : '(inline data)';
    const primary = emission !== undefined && plan?.multi === true && emission.primary;
    const auth = entry.auth !== undefined && entry.auth.status !== 'none' ? ' (requires auth)' : '';
    stdout(`[ax]   • ${label} → ${where}${primary ? ' (primary)' : ''}${auth}`);
  }

  // Twins and the auth guide are public surface too, so the gate must show them: one short line
  // with the count and a few sample paths, not the full list (the report carries that).
  const twins = generated.twinPlan.writes;
  if (twins.length > 0) {
    const sample = twins.slice(0, 3).map((twin) => twin.servedPath);
    const more = twins.length > sample.length ? ', …' : '';
    stdout(
      `[ax]   • Markdown twins → ${twins.length} page${twins.length === 1 ? '' : 's'} ` +
        `(${sample.join(', ')}${more})`,
    );
  }
  if (generated.authMdPlan !== undefined) {
    const { surfaceCount } = generated.authMdPlan;
    stdout(
      `[ax]   • Auth guide → ${generated.authMdPlan.servedPath} (${surfaceCount} gated ` +
        `surface${surfaceCount === 1 ? '' : 's'})`,
    );
  }
}

/**
 * Reconciles the applied twin/auth-guide results into the report and the terminal. The split is
 * deliberate: the terminal gets counts and pointers; the per-route skip reasons (the actionable
 * prose) live in the report. Without a report, the compact reason list prints here instead so the
 * information isn't silently dropped.
 */
function reportMarkdownTwinOutcome(
  cwd: string,
  generated: GenerateCatalogResult,
  twinResult: ApplyTwinPlanResult,
  authMdResult: ApplyAuthMdResult,
  reportTarget: true | string | undefined,
  stdout: (line: string) => void,
): void {
  const twins = generated.report.markdownTwins;
  twins.written = twinResult.written.map((twin) => ({
    route: twin.route,
    path: relative(cwd, twin.filePath),
    tier: twin.tier,
    source: twin.source,
  }));
  twins.deleted = twinResult.deleted;
  if (authMdResult.written === undefined) delete twins.authMd;

  // The twins and auth guide written this run are shown (with their sizes) in the consolidated file
  // tree the caller prints, so no "✓ wrote" summary line here. Removals and the skipped-route
  // warning stay: they aren't files that landed on disk, so the tree has no row for them.
  if (authMdResult.deleted !== undefined) {
    stdout(`[ax] ✓ removed ${authMdResult.deleted} (no gated surfaces remain)`);
  }
  if (twinResult.deleted.length > 0) {
    stdout(
      `[ax] ✓ removed ${twinResult.deleted.length} stale markdown twin` +
        `${twinResult.deleted.length === 1 ? '' : 's'}`,
    );
  }

  const skipped = twins.skipped;
  if (twins.enabled && skipped.length > 0) {
    if (reportTarget !== undefined) {
      stdout(
        `[ax] ⚠ ${skipped.length} route${skipped.length === 1 ? ' has' : 's have'} no markdown ` +
          'twin — per-route reasons recorded in the report',
      );
    } else {
      stdout(
        `[ax] ⚠ no markdown twin for ${skipped
          .map((skip) => `${skip.route} (${skip.reason})`)
          .join(', ')}`,
      );
    }
  }
}

/**
 * The `ax manifest` subcommand: regenerate the serving-manifest data module from the source tree.
 * Deliberately tiny (one flag) and fast (no build output, no converters) — it exists to run as a
 * `prebuild` script, before `next build` compiles the middleware that imports the module.
 */
async function runManifestCommand(
  argv: string[],
  io: CliIO,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> {
  let cwdArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '-h' || arg === '--help') {
      stdout(
        'ax manifest — regenerate the serving-manifest data module (ax-manifest.{ts,js})\n\n' +
          'Usage:\n  ax manifest [--cwd <dir>]\n\n' +
          'Derives everything from the source tree (routes, gating, twins and artifacts present in\n' +
          'public/), so it is fast enough to wire as "prebuild" — which keeps the manifest fresh\n' +
          'before next build compiles the middleware that imports it.',
      );
      return 0;
    }
    if (arg === '--cwd') {
      const value = argv[++i];
      if (value === undefined) {
        stderr('[ax] --cwd requires a directory argument');
        return 1;
      }
      cwdArg = value;
    } else if (arg.startsWith('--cwd=')) {
      const value = arg.slice('--cwd='.length);
      if (value === '') {
        stderr('[ax] --cwd requires a directory argument');
        return 1;
      }
      cwdArg = value;
    } else {
      stderr(`[ax] Unrecognized argument: ${arg}`);
      return 1;
    }
  }

  const cwd = resolve(cwdArg ?? io.cwd ?? process.cwd());
  try {
    const result = await writeServingManifest(cwd, (message) => stdout(`[ax] ⚠ ${message}`));
    const twinCount = Object.keys(result.data.markdownTwins).length;
    stdout(
      `[ax] ✓ wrote ${result.path} (serving manifest: ${result.data.routes.length} routes, ` +
        `${twinCount} markdown twin${twinCount === 1 ? '' : 's'}, ` +
        `${result.data.gatedPaths.length} gated path${result.data.gatedPaths.length === 1 ? '' : 's'})`,
    );
    return 0;
  } catch (err) {
    if (err instanceof AxConfigError) {
      stderr(`[ax] ${err.message}`);
      return 1;
    }
    throw err;
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
