import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { AxConfigError, findExistingConfig } from './config.js';
import { generateCatalog } from './generate.js';
import { defaultIsGated, type GateTarget } from './gating.js';
import {
  configFileName,
  type ConfigFileTarget,
  type GatingAnswer,
  type InitAnswers,
  renderAxConfig,
} from './init-config.js';
import { planPostbuildWiring, POSTBUILD_COMMAND } from './init-package-json.js';
import { createReadlinePrompter, type MultiSelectChoice, type Prompter } from './prompt.js';
import { buildRouterModel, type RouterKind } from './router-model.js';
import { readSiteUrlFromEnv, servedPath } from './site-url.js';

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

/** A gated-surface candidate the multi-select offers, plus whether it starts selected. */
interface GateCandidate {
  value: string;
  label: string;
  selected: boolean;
}

/** Sentinel value for the built-in floor row in the gated multi-select. */
const FLOOR_VALUE = '__ax_floor__';

interface InitFindings {
  routers: RouterKind[];
  staticRouteCount: number;
  /**
   * `next.config` `basePath` (`''` when unset). Gated-surface candidates are prefixed with it, so
   * the `isGated` the wizard writes matches the basePath-prefixed `target.path` a real build passes.
   */
  basePath: string;
  mcpMounts: { pathname: string; tools: string[] }[];
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
  return {
    routers: report.routers,
    staticRouteCount: router.listPageRoutes().length,
    basePath: report.basePath,
    mcpMounts: report.mcp.mounts.map((mount) => ({ pathname: mount.pathname, tools: mount.tools })),
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
  stdout(
    `[ax]   • Router: ${findings.routers.length > 0 ? findings.routers.join(' + ') : 'none detected'}`,
  );
  stdout(`[ax]   • Statically addressable routes: ${findings.staticRouteCount}`);
  if (findings.mcpMounts.length > 0) {
    stdout(
      `[ax]   • MCP server${findings.mcpMounts.length === 1 ? '' : 's'}: ` +
        findings.mcpMounts.map((m) => m.pathname).join(', '),
    );
  }
  if (findings.openApiFound) stdout('[ax]   • OpenAPI doc: public/openapi.json');
  if (findings.webMcpToolNames.length > 0) {
    stdout(`[ax]   • WebMCP tools: ${findings.webMcpToolNames.join(', ')}`);
  }
  const present = [
    findings.artifacts.llmsTxt && 'llms.txt',
    findings.artifacts.robotsTxt && 'robots.txt',
    findings.artifacts.sitemap && 'sitemap',
    findings.artifacts.agentsMd && 'agents.md',
    findings.artifacts.jsonLd && 'JSON-LD',
  ].filter((v): v is string => typeof v === 'string');
  stdout(
    `[ax]   • Existing discovery artifacts: ${present.length > 0 ? present.join(', ') : 'none'}`,
  );
}

/**
 * The gated-surface candidates: the built-in floor (always offered, so it can be deselected) plus
 * every detected surface an `isGated` matcher can name. A surface starts selected only when the
 * built-in floor would already gate it — the wizard proposes what's safe by default and lets the
 * user add the rest, rather than guessing that a detected mount is private.
 *
 * A candidate's `value` is the *served* path (basePath prefix included), because that is exactly
 * what a real build passes as `isGated`'s `target.path` (`entryUrlPath` reads it off the
 * basePath-prefixed entry URL). Matching on the raw router pathname instead would make the generated
 * matcher silently miss on any `basePath` app — publishing a surface the user marked gated as open.
 */
function gateCandidates(findings: InitFindings): GateCandidate[] {
  const candidates: GateCandidate[] = [
    {
      value: FLOOR_VALUE,
      label: 'Built-in floor: /api/auth/** and /api/webhooks/** (recommended)',
      selected: true,
    },
  ];
  const served = (pathname: string): string => servedPath(findings.basePath, pathname);
  const preselect = (kind: GateTarget['kind'], path: string): boolean =>
    defaultIsGated({ kind, path });
  for (const mount of findings.mcpMounts) {
    const path = served(mount.pathname);
    candidates.push({
      value: path,
      label: `MCP server (${path})${mount.tools.length > 0 ? ` — ${mount.tools.join(', ')}` : ''}`,
      selected: preselect('mcp', path),
    });
  }
  if (findings.openApiFound) {
    const path = served('/openapi.json');
    candidates.push({
      value: path,
      label: `OpenAPI doc (${path})`,
      selected: preselect('openapi', path),
    });
  }
  return candidates;
}

/** Turns the multi-select result back into the floor/extra-paths shape the config renderer wants. */
function toGatingAnswer(selected: string[]): GatingAnswer {
  return {
    floorKept: selected.includes(FLOOR_VALUE),
    gatedPaths: selected.filter((v) => v !== FLOOR_VALUE),
  };
}

/**
 * Asks the questions the source tree can't answer, each with a default. Returns undefined only when
 * a required answer (a valid siteUrl) couldn't be obtained after several tries.
 */
async function collectInteractive(
  prompter: Prompter,
  findings: InitFindings,
  defaultSiteUrl: string | undefined,
  stdout: (line: string) => void,
): Promise<InitAnswers | undefined> {
  let siteUrl: string | undefined;
  for (let attempt = 0; attempt < 5 && siteUrl === undefined; attempt++) {
    const raw = await prompter.text(
      "Your site's public production URL (written into the published catalog)",
      defaultSiteUrl,
    );
    const result = validateSiteUrl(raw);
    if (result.ok) siteUrl = result.value;
    else stdout(`[ax] ${result.reason}`);
  }
  if (siteUrl === undefined) return undefined;

  const gating = toGatingAnswer(
    await prompter.multiSelect(
      'Which surfaces are gated behind auth? (ax will never advertise these as open)',
      gateCandidates(findings) as MultiSelectChoice[],
    ),
  );

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
    siteUrl,
    scaffoldLlmsTxt,
    scaffoldJsonLd,
    scaffoldRobots,
    scaffoldAgent404,
    report,
    gating,
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

  // Never overwrite: if an `ax.config.*` already exists, this is not a fresh setup. Point at it and
  // stop, rather than writing a fresh one that would silently shadow it (same write-once posture as
  // the scaffolds). `findExistingConfig` deliberately does not look for a legacy `ard.config.*`
  // here — that file is unsupported, not "already configured" — so this guard alone would let init
  // run straight into writing a fresh `ax.config.*` over top of it.
  const existingConfig = findExistingConfig(cwd);
  if (existingConfig !== undefined) {
    stderr(
      `[ax] ${relative(cwd, existingConfig) || existingConfig} already exists — not overwriting. ` +
        'Edit it directly, or delete it to re-run ax init.',
    );
    return 1;
  }

  // Detection below reuses `generateCatalog`, which throws `AxConfigError` when it finds only an
  // `ard.config.*` (see config.ts) — the same loud failure a build would hit. Decision: `ax init`
  // surfaces that error and refuses rather than proceeding to write a fresh `ax.config.*` next to
  // the broken one. Writing a second file the developer didn't ask to fix would leave the stale
  // `ard.config.*` behind with no signal that it's now dead weight; refusing keeps the message the
  // developer actually needs (rename the file) in front of them, matching the build's behavior
  // instead of only fixing half the project.
  let findings: InitFindings;
  try {
    findings = await gatherFindings(cwd);
  } catch (err) {
    if (err instanceof AxConfigError) {
      stderr(`[ax] ${err.message}`);
      return 1;
    }
    throw err;
  }
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
    // Non-interactive applies every default: scaffolds and report on (yes-when-asked), and the
    // gating floor kept with no extra surfaces (so `isGated` is omitted — the floor is the default).
    const answers: InitAnswers = {
      siteUrl: validated.value,
      scaffoldLlmsTxt: true,
      scaffoldJsonLd: true,
      scaffoldRobots: true,
      scaffoldAgent404: true,
      report: true,
      gating: { floorKept: true, gatedPaths: [] },
    };
    const fileName = writeConfigAndWire(cwd, answers, stdout);
    printNextSteps(fileName, answers, false, stdout);
    return 0;
  }

  let prompter = io.prompter;
  let close = (): void => {};
  if (prompter === undefined) {
    const created = await createReadlinePrompter();
    prompter = created;
    close = () => created.close();
  }
  try {
    const answers = await collectInteractive(
      prompter,
      findings,
      args.siteUrl ?? readSiteUrlFromEnv(),
      stdout,
    );
    if (answers === undefined) {
      stderr('[ax] No valid site URL provided — aborting without writing anything.');
      return 1;
    }

    const fileName = writeConfigAndWire(cwd, answers, stdout);

    // Offer the first build so the report shows up immediately. Default no — spawning a full
    // `next build` is heavy and should never happen without an explicit yes.
    let ranBuild = false;
    if (await prompter.confirm('Run the first build now so you can see the report?', false)) {
      const spawnBuild = io.spawnBuild ?? defaultSpawnBuild;
      const code = await spawnBuild(cwd);
      ranBuild = code === 0;
      if (!ranBuild) stdout('[ax] ⚠ Build did not finish cleanly — run it yourself when ready.');
    }

    printNextSteps(fileName, answers, ranBuild, stdout);
    return 0;
  } finally {
    close();
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
  answers: InitAnswers,
  ranBuild: boolean,
  stdout: (line: string) => void,
): void {
  stdout('[ax] Done. Next steps:');
  stdout(`[ax]   1. Review ${fileName} — every field has a comment explaining why it's there.`);
  if (!ranBuild) {
    stdout(
      '[ax]   2. Run your build; the postbuild step generates the catalog and shows the report.',
    );
  }
  if (answers.scaffoldJsonLd) {
    stdout(
      '[ax]   • JSON-LD: after the build, add the printed import/element to your layout — ax never edits it for you.',
    );
  }
}
