import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { findExistingConfig } from './config.js';
import { detectMcpMounts, type McpMount } from './detect-mcp.js';
import { generateCatalog } from './generate.js';
import {
  configFileName,
  type ConfigFileTarget,
  type InitAnswers,
  renderAxConfig,
} from './init-config.js';
import { planPostbuildWiring, POSTBUILD_COMMAND } from './init-package-json.js';
import { createReadlinePrompter, type MultiSelectChoice, type Prompter } from './prompt.js';
import { renderRouteTree } from './route-tree.js';
import { buildRouterModel, type RouterKind } from './router-model.js';
import { buildMcpServerCard } from './server-card.js';
import { readSiteMetadata } from './site-metadata.js';
import { readSiteUrlFromEnv, servedPath } from './site-url.js';
import { writeServerCard } from './write.js';

export interface InitIO {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /**
   * The prompt layer. Injected so the wizard is unit-testable with scripted answers and no TTY;
   * in real interactive use it's left undefined and a readline-backed prompter is created. Only
   * consulted on an interactive (non-`--yes`) run.
   */
  prompter?: Prompter;
  /**
   * Runs the first build so the user sees the report immediately. Injected so tests never spawn a
   * real `next build`; defaults to running the detected package manager's `build` script.
   */
  spawnBuild?: (cwd: string) => Promise<number>;
}

interface ParsedInitArgs {
  help: boolean;
  yes: boolean;
  cwd?: string;
  siteUrl?: string;
}

class InitArgError extends Error {}

const INIT_HELP = `ax init — set up ax.config and wire your build

Usage:
  ax init [options]

Runs ax's source-tree detection, asks only what it can't derive, writes ax.config, and wires a
"postbuild": "ax" script. Never overwrites an existing ax.config; never edits an existing postbuild.

Options:
  --site-url <url>   Your public production origin (https://…). Required with --yes; otherwise
                     prompted for. Also read from SITE_URL / NEXT_PUBLIC_SITE_URL.
  --yes, -y          Non-interactive: accept every default. Requires --site-url (or the env var).
  --cwd <dir>        Project root to run in (defaults to the current working directory).
  -h, --help         Print this help text.
`;

function parseInitArgs(argv: string[]): ParsedInitArgs {
  const parsed: ParsedInitArgs = { help: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    } else if (arg === '--yes' || arg === '-y') {
      parsed.yes = true;
    } else if (arg === '--cwd') {
      const value = argv[++i];
      if (value === undefined) throw new InitArgError('--cwd requires a directory argument');
      parsed.cwd = value;
    } else if (arg.startsWith('--cwd=')) {
      const value = arg.slice('--cwd='.length);
      if (value === '') throw new InitArgError('--cwd requires a directory argument');
      parsed.cwd = value;
    } else if (arg === '--site-url') {
      const value = argv[++i];
      if (value === undefined) throw new InitArgError('--site-url requires a URL argument');
      parsed.siteUrl = value;
    } else if (arg.startsWith('--site-url=')) {
      const value = arg.slice('--site-url='.length);
      if (value === '') throw new InitArgError('--site-url requires a URL argument');
      parsed.siteUrl = value;
    } else {
      throw new InitArgError(`Unrecognized argument: ${arg}`);
    }
  }
  return parsed;
}

/**
 * Validates a candidate `siteUrl` for the one job it has to do: it is written verbatim into the
 * public catalog's entry URLs, so it must be a real, absolute production origin. A localhost or
 * preview URL would publish links agents can't reach — the exact failure this refusal prevents.
 * On success returns the normalized origin (scheme + host, no path/query).
 */
export function validateSiteUrl(
  input: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'A site URL is required — e.g. https://yourdomain.com.' };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: `"${trimmed}" is not a valid URL — give an absolute origin like https://yourdomain.com.`,
    };
  }
  if (url.protocol !== 'https:') {
    return {
      ok: false,
      reason: `Use an https:// origin (got "${trimmed}"). This value is written into the public catalog's URLs.`,
    };
  }
  // Strip a trailing dot before the checks: `https://localhost.` / `https://127.0.0.1.` are the same
  // hosts (the root-label dot survives URL parsing) and would otherwise slip past the equality tests.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const loopback =
    host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]';
  if (loopback || host.endsWith('.local') || !host.includes('.')) {
    return {
      ok: false,
      reason:
        `"${trimmed}" looks like a local or preview URL. Use your public production origin — it is ` +
        'written verbatim into the catalog URLs agents fetch, so a localhost/preview value publishes broken links.',
    };
  }
  return { ok: true, value: url.origin };
}

/** A candidate `siteUrl` default plus a human-readable label for where it was found. */
interface SiteUrlDefault {
  value?: string;
  source?: string;
}

/**
 * The `siteUrl` to prefill and where it came from, in the same precedence a build resolves it. The
 * source label matters: it turns "is this URL right?" from a guess into an informed check ("that's
 * my NEXT_PUBLIC_SITE_URL — yes"). `.env*` files are already loaded into `process.env` by the
 * detection pass that runs before this, so reading them here is enough.
 */
function detectSiteUrlDefault(flagSiteUrl: string | undefined): SiteUrlDefault {
  if (flagSiteUrl !== undefined) return { value: flagSiteUrl, source: '--site-url' };
  const env = (name: string): SiteUrlDefault | undefined => {
    const value = process.env[name]?.trim();
    return value ? { value, source: name } : undefined;
  };
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return (
    env('SITE_URL') ??
    env('NEXT_PUBLIC_SITE_URL') ??
    (vercel ? { value: `https://${vercel}`, source: 'VERCEL_PROJECT_PRODUCTION_URL' } : {})
  );
}

interface InitFindings {
  routers: RouterKind[];
  /** Every statically addressable page route, for the route-tree summary. */
  pageRoutes: string[];
  /** Every API route that resolves to a stable URL (MCP mounts included), for the route tree. */
  apiRoutePaths: string[];
  /**
   * `next.config` `basePath` (`''` when unset). Every displayed path is prefixed with it, so what
   * the tree and the gating question show is exactly the served path a real build gates on.
   */
  basePath: string;
  /** Detected mounts, kept whole: the gating card is built from these after the answers land. */
  mcpMounts: McpMount[];
  openApiFound: boolean;
  webMcpToolNames: string[];
  /** Presence of each detect-and-recommend artifact, for the findings summary. */
  artifacts: {
    llmsTxt: boolean;
    robotsTxt: boolean;
    sitemap: boolean;
    agentsMd: boolean;
    jsonLd: boolean;
    openapi: boolean;
  };
}

/**
 * Runs ax's existing source-tree detection pass and distills it into the facts the wizard shows and
 * asks about. Reuses `generateCatalog` — the same detection the build runs — so the wizard can
 * never drift from what a real `ax` build sees, and adds only the static-route count from the shared
 * router model. No `next build`, no writes: `generateCatalog` scaffolds nothing without a config
 * (there is none yet) and never writes the catalog itself.
 */
async function gatherFindings(cwd: string): Promise<InitFindings> {
  const generated = await generateCatalog({ cwd });
  const { report } = generated;
  const router = buildRouterModel(cwd);
  // Re-run the mount scan directly (cheap — the router model is shared) because the report's mount
  // list carries no auth posture, and both the pre-selection heuristic and the gating card need
  // the whole mounts (withMcpAuth detection, source file, resource-metadata path).
  const mounts = detectMcpMounts({ cwd, warn: () => {}, router });
  const apiRoutePaths = [
    ...new Set(
      router
        .listApiEndpoints()
        .map((endpoint) => endpoint.url)
        .filter((url): url is string => url !== undefined),
    ),
  ].sort();
  return {
    routers: report.routers,
    pageRoutes: router.listPageRoutes(),
    apiRoutePaths,
    basePath: report.basePath,
    mcpMounts: mounts,
    openApiFound: report.artifacts.openapi.found,
    webMcpToolNames: generated.webMcpToolNames,
    artifacts: {
      llmsTxt: report.artifacts.llmsTxt.found,
      robotsTxt: report.artifacts.robotsTxt.found,
      sitemap: report.artifacts.sitemap.found,
      agentsMd: report.artifacts.agentsMd.found,
      jsonLd: report.artifacts.jsonLd.found,
      openapi: report.artifacts.openapi.found,
    },
  };
}

function printFindings(findings: InitFindings, stdout: (line: string) => void): void {
  stdout("[ax] Scanned your project (no build needed) — here's what I found:");
  // The route tree exists to serve the MCP gating decision, so it renders only when there is an
  // MCP server to decide about; without one, a one-line count carries the same information.
  if (findings.mcpMounts.length > 0) {
    stdout('[ax]');
    const lines = renderRouteTree({
      routers: findings.routers,
      pageRoutes: findings.pageRoutes,
      apiRoutePaths: findings.apiRoutePaths,
      basePath: findings.basePath,
      mounts: findings.mcpMounts.map((mount) => ({
        pathname: mount.pathname,
        tools: mount.capabilities,
        authDetected: mount.auth !== undefined,
      })),
    });
    for (const line of lines) stdout(`[ax] ${line}`.trimEnd());
    stdout('[ax]');
  } else {
    const pages = findings.pageRoutes.length;
    const apis = findings.apiRoutePaths.length;
    stdout(
      `[ax]   • Routes: ${pages} page${pages === 1 ? '' : 's'}, ${apis} API route` +
        `${apis === 1 ? '' : 's'} — no MCP server detected`,
    );
  }
  if (findings.webMcpToolNames.length > 0) {
    stdout(`[ax]   • WebMCP tools: ${findings.webMcpToolNames.join(', ')}`);
  }
  const present = [
    findings.artifacts.llmsTxt && 'llms.txt',
    findings.artifacts.openapi && 'openapi.json',
    findings.artifacts.robotsTxt && 'robots.txt',
    findings.artifacts.sitemap && 'sitemap',
    findings.artifacts.agentsMd && 'agents.md',
    findings.artifacts.jsonLd && 'JSON-LD',
  ].filter((v): v is string => typeof v === 'string');
  stdout(
    `[ax]   • Existing discovery artifacts: ${present.length > 0 ? present.join(', ') : 'none'}`,
  );
}

/** The built-in floor paths, for the human-readable gating summary. */
const FLOOR_SUMMARY = '/api/auth/** & /api/webhooks/**';

/**
 * Runs the gating question — per MCP *server*, because auth is declared at the server level in the
 * MCP conventions (the card's `authentication` block). The tools render as leaves under each
 * server so the decision is made looking at what it exposes, but they are not separately
 * selectable. Selected means **public**: pressing Enter with everything selected says "none
 * require logging in", and an unselected server is published as *requiring auth* (recorded in its
 * server card), never advertised as open. A `withMcpAuth`-wrapped mount starts deselected — its
 * own code already demands auth. The built-in auth/webhook floor always applies on top. Returns
 * the pathnames of the gated mounts.
 */
async function askGating(
  prompter: Prompter,
  findings: InitFindings,
  stdout: (line: string) => void,
): Promise<Set<string>> {
  if (findings.mcpMounts.length === 0) return new Set();
  const served = (pathname: string): string => servedPath(findings.basePath, pathname);

  const choices: MultiSelectChoice[] = findings.mcpMounts.map((mount) => {
    // Tool leaves are part of the label (indented past the prompter's "  1. [x] " prefix), so the
    // user decides about the server while looking at exactly what it exposes.
    const leaves = mount.capabilities
      .map((tool, i) => `\n         ${i < mount.capabilities.length - 1 ? '├' : '└'} ⚙ ${tool}`)
      .join('');
    return {
      value: mount.pathname,
      label:
        `ƒ ${served(mount.pathname)} — MCP server` +
        `${mount.auth !== undefined ? ' (auth detected)' : ''}${leaves}`,
      selected: mount.auth === undefined,
    };
  });

  const preDeselected = choices.filter((choice) => !choice.selected).length;
  const question =
    "Which of these MCP servers DON'T require logging in? Press Enter if none require logging " +
    'in; otherwise select only the publicly available ones — an unselected server is published ' +
    'as requiring auth, never advertised as open.' +
    (preDeselected > 0
      ? ` (ax pre-deselected ${preDeselected} whose code already demands auth.)`
      : '');
  const publicValues = new Set(await prompter.multiSelect(question, choices));

  const gated = new Set(
    findings.mcpMounts.map((mount) => mount.pathname).filter((p) => !publicValues.has(p)),
  );
  const publicList = findings.mcpMounts
    .filter((mount) => !gated.has(mount.pathname))
    .map((mount) => served(mount.pathname));
  const gatedList = [...gated].map(served);
  stdout(
    `[ax]   Public (advertised to agents): ${publicList.length > 0 ? publicList.join(', ') : 'none'}`,
  );
  stdout(
    `[ax]   Requires login (not advertised as open): ${
      gatedList.length > 0
        ? `${gatedList.join(', ')}, plus the built-in ${FLOOR_SUMMARY} floor`
        : `the built-in ${FLOOR_SUMMARY} floor`
    }`,
  );
  return gated;
}

/**
 * Writes the well-known MCP server card straight from the wizard — the actionable artifact `init`
 * exists to produce for an app that already has an MCP server, and the *persistence* for the
 * gating answer: the card's `authentication` block is what the next build reads back, so the
 * decision is asked once, not on every build. Only a single mount can own the single well-known
 * path; with several, `buildMcpServerCard` skips with its own recommendation and the build's
 * review gate asks per run instead.
 */
function writeGatingCard(
  cwd: string,
  findings: InitFindings,
  siteUrl: string,
  gatedMounts: Set<string>,
  stdout: (line: string) => void,
): void {
  if (findings.mcpMounts.length === 0) return;
  const mounts = findings.mcpMounts.map((mount) =>
    gatedMounts.has(mount.pathname) && mount.auth === undefined
      ? { ...mount, auth: { status: 'unknown' as const } }
      : mount,
  );
  const card = buildMcpServerCard({
    mounts,
    siteUrl,
    basePath: findings.basePath,
    site: readSiteMetadata(cwd),
    recommend: (message) => stdout(`[ax] ${message}`),
  });
  if (card === undefined) return;
  const { path } = writeServerCard(cwd, card);
  stdout(
    `[ax] ✓ wrote ${relative(cwd, path)} (MCP server card` +
      `${card.authentication !== undefined ? ' — marked as requiring auth' : ''}). Commit it: ` +
      'it records your gating decision, so builds never re-ask.',
  );
}

/**
 * Asks the questions the source tree can't answer, each with a default. Returns undefined only when
 * a required answer (a valid siteUrl) couldn't be obtained after several tries. The gating answer
 * comes back separately from the config answers: it lands in the server card, never in ax.config.
 */
async function collectInteractive(
  prompter: Prompter,
  findings: InitFindings,
  siteUrlDefault: SiteUrlDefault,
  stdout: (line: string) => void,
): Promise<{ answers: InitAnswers; gatedMounts: Set<string> } | undefined> {
  // Tell the user where the prefilled value came from, so "is this right?" is an informed check
  // rather than a mystery string. The value itself is prefilled as editable input by the prompter.
  if (siteUrlDefault.value !== undefined && siteUrlDefault.source !== undefined) {
    stdout(
      `[ax] Prefilled your site URL from ${siteUrlDefault.source} — press Enter to keep it, or edit.`,
    );
  }
  let siteUrl: string | undefined;
  for (let attempt = 0; attempt < 5 && siteUrl === undefined; attempt++) {
    const raw = await prompter.text(
      'Your public production origin — the exact URL agents fetch (written verbatim into your catalog)',
      siteUrlDefault.value,
    );
    const result = validateSiteUrl(raw);
    if (result.ok) siteUrl = result.value;
    else stdout(`[ax] ${result.reason}`);
  }
  if (siteUrl === undefined) return undefined;

  const gatedMounts = await askGating(prompter, findings, stdout);

  // Scaffolds default to yes in the wizard: config defaults are false because a *silent* write into
  // a source tree is invasive, but here the ask itself is the opt-in and the user is present to say
  // no. Same yes-when-asked / no-when-silent policy the README documents.
  const scaffoldLlmsTxt = await prompter.confirm(
    'Scaffold a starter llms.txt from your routes?',
    true,
  );
  const scaffoldJsonLd = await prompter.confirm(
    'Scaffold an Organization JSON-LD component?',
    true,
  );
  const scaffoldRobots = await prompter.confirm(
    'Add discovery pointers + AI-crawler rules to robots.txt?',
    true,
  );
  const scaffoldAgent404 = await prompter.confirm('Scaffold an agent-aware 404 page?', true);
  const report = await prompter.confirm('Write .ora/report.json (the agent handoff report)?', true);

  return {
    answers: { siteUrl, scaffoldLlmsTxt, scaffoldJsonLd, scaffoldRobots, scaffoldAgent404, report },
    gatedMounts,
  };
}

/** The config file target, derived from the project — never asked (see the "detect first" posture). */
function resolveConfigTarget(cwd: string): ConfigFileTarget {
  const language: ConfigFileTarget['language'] = existsSync(join(cwd, 'tsconfig.json'))
    ? 'ts'
    : 'js';
  let moduleSystem: ConfigFileTarget['moduleSystem'] = 'cjs';
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { type?: string };
    if (pkg.type === 'module') moduleSystem = 'esm';
  } catch {
    // No/unreadable package.json — the `cjs` default is the safe fallback for a bare `.js` file.
  }
  return { language, moduleSystem };
}

/** Adds a `"postbuild": "ax"` script after `build`, preserving the rest of package.json verbatim. */
function wirePackageJson(
  cwd: string,
  stdout: (line: string) => void,
  warn: (line: string) => void,
): void {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    warn(
      'No package.json found — skipped wiring the build. Add a "postbuild": "ax" script yourself ' +
        'so the catalog regenerates on every build.',
    );
    return;
  }

  let pkg: Record<string, unknown>;
  let raw: string;
  try {
    raw = readFileSync(pkgPath, 'utf8');
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    warn(
      `Could not read package.json (${(err as Error).message}) — wire "postbuild": "ax" yourself.`,
    );
    return;
  }

  // A `scripts` that isn't a plain object is malformed package.json — iterating it (a string would
  // yield its characters, an array its indices) would corrupt the file. Refuse rather than guess.
  const rawScripts = pkg.scripts;
  if (rawScripts !== undefined && (typeof rawScripts !== 'object' || Array.isArray(rawScripts))) {
    warn('package.json "scripts" is not an object — wire "postbuild": "ax" yourself.');
    return;
  }
  const scripts = rawScripts as Record<string, unknown> | undefined;
  const plan = planPostbuildWiring(scripts);

  if (plan.action === 'already-wired') {
    stdout('[ax] package.json already runs ax on postbuild — leaving it as is.');
    return;
  }
  if (plan.action === 'manual') {
    stdout(`[ax] ${plan.instruction}`);
    return;
  }

  // action === 'add': insert postbuild right after build so the two read together. Any pre-existing
  // `postbuild` key is dropped as it's re-copied — `add` only fires when it was absent or blank, and
  // re-emitting it later in iteration order would otherwise clobber the "ax" we just inserted.
  const rebuilt: Record<string, unknown> = {};
  const source = scripts ?? {};
  let inserted = false;
  for (const [key, value] of Object.entries(source)) {
    if (key === 'postbuild') continue;
    rebuilt[key] = value;
    if (key === 'build') {
      rebuilt.postbuild = POSTBUILD_COMMAND;
      inserted = true;
    }
  }
  if (!inserted) rebuilt.postbuild = POSTBUILD_COMMAND;

  pkg.scripts = rebuilt;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  stdout('[ax] ✓ added "postbuild": "ax" to package.json');
}

/** Detects the package manager from a lockfile so the build offer runs the right one. */
function detectPackageManager(cwd: string): string {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

/** The real build runner: spawns `<pm> run build`, inheriting stdio so the user sees it live. */
function defaultSpawnBuild(cwd: string): Promise<number> {
  const pm = detectPackageManager(cwd);
  return new Promise((resolvePromise) => {
    const child = spawn(pm, ['run', 'build'], { cwd, stdio: 'inherit', shell: false });
    child.on('error', () => resolvePromise(1));
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

/**
 * Runs the `ax init` onboarding wizard end to end and returns a process exit code. Like `runCli`,
 * it never throws for expected failure modes (bad args, an existing config, an invalid site URL) —
 * those are reported via `stderr` and a non-zero code.
 */
export async function runInit(argv: string[], io: InitIO = {}): Promise<number> {
  const stdout = io.stdout ?? ((line: string) => console.log(line));
  const stderr = io.stderr ?? ((line: string) => console.error(line));

  let args: ParsedInitArgs;
  try {
    args = parseInitArgs(argv);
  } catch (err) {
    stderr(`[ax] ${(err as Error).message}`);
    stderr(INIT_HELP);
    return 1;
  }

  if (args.help) {
    stdout(INIT_HELP);
    return 0;
  }

  const cwd = resolve(args.cwd ?? io.cwd ?? process.cwd());

  // Never overwrite: if a config `loadAxConfig` would honor already exists — an `ax.config.*` or a
  // still-loaded legacy `ard.config.*` — this is not a fresh setup. Point at it and stop, rather
  // than writing a fresh `ax.config.*` that would silently shadow it (same write-once posture as the
  // scaffolds).
  const existingConfig = findExistingConfig(cwd);
  if (existingConfig !== undefined) {
    stderr(
      `[ax] ${relative(cwd, existingConfig) || existingConfig} already exists — not overwriting. ` +
        'Edit it directly, or delete it to re-run ax init.',
    );
    return 1;
  }

  const findings = await gatherFindings(cwd);
  printFindings(findings, stdout);

  const interactive =
    io.prompter !== undefined ||
    (process.stdin.isTTY === true && process.stdout.isTTY === true && !process.env.CI);

  if (!args.yes && !interactive) {
    stderr(
      '[ax] ax init needs an interactive terminal to prompt. In a non-interactive shell, run ' +
        '`ax init --yes --site-url https://yourdomain.com` to accept all defaults.',
    );
    return 1;
  }

  // In headless mode there's no prompter and no build offer; interactively, one prompter serves
  // every question and the build offer, and is closed once at the very end.
  if (args.yes) {
    const candidate = args.siteUrl ?? readSiteUrlFromEnv();
    if (candidate === undefined) {
      stderr(
        '[ax] --yes needs a site URL: pass --site-url https://yourdomain.com (or set SITE_URL / ' +
          'NEXT_PUBLIC_SITE_URL). It has no default — it is written verbatim into your public catalog.',
      );
      return 1;
    }
    const validated = validateSiteUrl(candidate);
    if (!validated.ok) {
      stderr(`[ax] ${validated.reason}`);
      return 1;
    }
    // Non-interactive applies every default: scaffolds and report on (yes-when-asked). No gating
    // question means no server card is written here — the first build detects the mounts, asks (or
    // warns in CI) about any without a recorded decision, and writes the card that records it.
    const answers: InitAnswers = {
      siteUrl: validated.value,
      scaffoldLlmsTxt: true,
      scaffoldJsonLd: true,
      scaffoldRobots: true,
      scaffoldAgent404: true,
      report: true,
    };
    const fileName = writeConfigAndWire(cwd, answers, stdout);
    printNextSteps(fileName, answers, false, stdout);
    return 0;
  }

  let prompter = io.prompter;
  let close = (): void => {};
  let closed = false;
  if (prompter === undefined) {
    const created = await createReadlinePrompter();
    prompter = created;
    close = () => created.close();
  }
  try {
    const collected = await collectInteractive(
      prompter,
      findings,
      detectSiteUrlDefault(args.siteUrl),
      stdout,
    );
    if (collected === undefined) {
      stderr('[ax] No valid site URL provided — aborting without writing anything.');
      return 1;
    }
    const { answers, gatedMounts } = collected;

    const fileName = writeConfigAndWire(cwd, answers, stdout);
    writeGatingCard(cwd, findings, answers.siteUrl, gatedMounts, stdout);

    // Offer the first build so the report shows up immediately. Default no — spawning a full
    // `next build` is heavy and should never happen without an explicit yes.
    const wantBuild = await prompter.confirm(
      'Run the first build now so you can see the report?',
      false,
    );

    // Release the TTY *before* spawning the build: its `postbuild` step is `ax`, which opens its own
    // readline for the review-before-publish gate. Two readline interfaces reading one stdin
    // deadlock — the parent (still attached) swallows the keystrokes the child is waiting on — so the
    // publish prompt would hang forever. Closing here hands stdin cleanly to the child.
    close();
    closed = true;

    let ranBuild = false;
    if (wantBuild) {
      stdout(
        '[ax] Running your build — the review-before-publish gate will show the exact surface and ask before writing.',
      );
      const spawnBuild = io.spawnBuild ?? defaultSpawnBuild;
      const code = await spawnBuild(cwd);
      ranBuild = code === 0;
      if (!ranBuild) stdout('[ax] ⚠ Build did not finish cleanly — run it yourself when ready.');
    }

    printNextSteps(fileName, answers, ranBuild, stdout);
    return 0;
  } finally {
    if (!closed) close();
  }
}

/** Writes `ax.config.*` and wires the postbuild script; returns the config filename written. */
function writeConfigAndWire(
  cwd: string,
  answers: InitAnswers,
  stdout: (line: string) => void,
): string {
  const target = resolveConfigTarget(cwd);
  const source = renderAxConfig(answers, target);
  const fileName = configFileName(target);
  writeFileSync(join(cwd, fileName), source, 'utf8');
  stdout(`[ax] ✓ wrote ${fileName}`);
  wirePackageJson(cwd, stdout, (message) => stdout(`[ax] ⚠ ${message}`));
  return fileName;
}

function printNextSteps(
  fileName: string,
  _answers: InitAnswers,
  ranBuild: boolean,
  stdout: (line: string) => void,
): void {
  // Keep this short: a first-glance recap of what the wizard itself changed. The build's own output
  // (and .ora/report.json) is where the per-artifact detail lives — no need to restate it here.
  stdout('[ax] ✓ Setup complete.');
  stdout(`[ax]   Created ${fileName} (each field commented) and wired the build (see above).`);
  if (!ranBuild) {
    stdout(
      '[ax]   Next: run your build — the postbuild `ax` step publishes the catalog and prints the report.',
    );
  }
}
