import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { findExistingConfig } from './config.js';
import { detectMcpMounts } from './detect-mcp.js';
import { generateCatalog } from './generate.js';
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
   * `next.config` `basePath` (`''` when unset). Gated-surface candidates are prefixed with it, so
   * the `isGated` the wizard writes matches the basePath-prefixed `target.path` a real build passes.
   */
  basePath: string;
  mcpMounts: { pathname: string; tools: string[]; authDetected: boolean }[];
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
  // list carries no auth posture, and the wizard's pre-selection heuristic needs to know which
  // mounts are already wrapped in withMcpAuth.
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
    mcpMounts: mounts.map((mount) => ({
      pathname: mount.pathname,
      tools: mount.capabilities,
      authDetected: mount.auth !== undefined,
    })),
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

/** One row of the route-tree summary: a served path, its kind marker, and any MCP tool children. */
interface RouteTreeNode {
  path: string;
  marker: '○' | 'ƒ';
  note?: string;
  /** MCP tool names, rendered as selectable sub-routes of their mount. */
  children: string[];
}

/**
 * Distills the findings into the route rows the summary tree shows, sorted by path: page routes
 * (○), API route handlers (ƒ), MCP mounts (ƒ, with their tools as children — the sub-routes agents
 * actually call), and a detected OpenAPI doc. Every path is the *served* (basePath-prefixed) one,
 * so what the tree shows is exactly what the gating question later asks about.
 */
function buildRouteTree(findings: InitFindings): RouteTreeNode[] {
  const served = (pathname: string): string => servedPath(findings.basePath, pathname);
  const mcpPaths = new Set(findings.mcpMounts.map((mount) => mount.pathname));
  const nodes = new Map<string, RouteTreeNode>();
  for (const route of findings.pageRoutes) {
    nodes.set(served(route), { path: served(route), marker: '○', children: [] });
  }
  for (const route of findings.apiRoutePaths) {
    if (mcpPaths.has(route)) continue;
    nodes.set(served(route), { path: served(route), marker: 'ƒ', children: [] });
  }
  for (const mount of findings.mcpMounts) {
    nodes.set(served(mount.pathname), {
      path: served(mount.pathname),
      marker: 'ƒ',
      note: `MCP server${mount.authDetected ? ' · auth detected' : ''}`,
      children: mount.tools,
    });
  }
  if (findings.openApiFound) {
    const path = served('/openapi.json');
    nodes.set(path, { path, marker: '○', note: 'OpenAPI doc', children: [] });
  }
  return [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Renders the findings as a `next build`-style route tree — the layout developers already read
 * after every build — except MCP servers are broken into their tools as sub-routes, since those
 * (not the mount) are the callable agent surfaces. Returns the lines without the `[ax] ` prefix.
 */
function renderRouteTree(findings: InitFindings): string[] {
  const nodes = buildRouteTree(findings);
  if (nodes.length === 0) return ['No routes detected.'];
  const width = Math.max(...nodes.map((node) => node.path.length));
  const lines = [`Route (${findings.routers.length > 0 ? findings.routers.join(' + ') : 'none'})`];
  nodes.forEach((node, index) => {
    const connector = index === 0 && nodes.length > 1 ? '┌' : index < nodes.length - 1 ? '├' : '└';
    const padded = node.note !== undefined ? node.path.padEnd(width + 2) : node.path;
    lines.push(`${connector} ${node.marker} ${padded}${node.note ?? ''}`.trimEnd());
    const stem = index < nodes.length - 1 ? '│' : ' ';
    node.children.forEach((tool, toolIndex) => {
      const toolConnector = toolIndex < node.children.length - 1 ? '├' : '└';
      lines.push(`${stem}   ${toolConnector} ⚙ ${tool}`);
    });
  });
  const legend = ['○ page', 'ƒ api route'];
  if (nodes.some((node) => node.children.length > 0)) legend.push('⚙ MCP tool');
  lines.push('', legend.join('   '));
  return lines;
}

function printFindings(findings: InitFindings, stdout: (line: string) => void): void {
  stdout("[ax] Scanned your project (no build needed) — here's what I found:");
  stdout('[ax]');
  for (const line of renderRouteTree(findings)) stdout(`[ax] ${line}`.trimEnd());
  stdout('[ax]');
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
 * Name tokens that suggest a surface sits behind a login, for the pre-selection heuristic. Matched
 * against whole tokens (split on separators and camelCase), never substrings, so `author_search`
 * doesn't trip on `auth`.
 */
const LOGIN_NAME_TOKENS = new Set([
  'login',
  'logout',
  'signin',
  'signup',
  'signout',
  'auth',
  'oauth',
  'sso',
  'session',
  'sessions',
  'token',
  'tokens',
  'password',
  'credential',
  'credentials',
  'account',
  'accounts',
  'admin',
  'billing',
  'invoice',
  'invoices',
  'subscribe',
  'subscription',
  'checkout',
  'pay',
  'payment',
  'payments',
  'purchase',
  'profile',
  'me',
]);

/** True when a tool/path name looks login-gated (a whole token matches the login vocabulary). */
export function looksLoginGated(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => LOGIN_NAME_TOKENS.has(token));
}

/**
 * The selectable agent surfaces the gating question is about — each detected MCP *tool* (a tool,
 * not its mount, is the callable surface an agent sees, and gating is declared per tool), a
 * tool-less MCP mount as a whole, and an OpenAPI doc. Empty when the project exposes none, in which
 * case the wizard skips the question entirely.
 *
 * Selected means **public**. The pre-selection is a heuristic starting point, not a policy: docs
 * surfaces (an OpenAPI doc) start public — documentation is what agents must be able to read —
 * while a `withMcpAuth`-wrapped mount and tools whose names look login-shaped (login, checkout,
 * pay, account, …) start deselected, since most gated APIs are gated exactly there.
 *
 * Tool values are `path#tool` keys and whole-surface values are the *served* path (basePath prefix
 * included), because that is exactly what the generated matcher rebuilds from `target.path` /
 * `target.tool` when a real build runs.
 */
function publicSurfaceChoices(findings: InitFindings): MultiSelectChoice[] {
  const served = (pathname: string): string => servedPath(findings.basePath, pathname);
  const choices: MultiSelectChoice[] = [];
  for (const mount of findings.mcpMounts) {
    const path = served(mount.pathname);
    if (mount.tools.length === 0) {
      choices.push({
        value: path,
        label: `ƒ ${path} — MCP server${mount.authDetected ? ' (auth detected)' : ''}`,
        selected: !mount.authDetected,
      });
      continue;
    }
    for (const tool of mount.tools) {
      choices.push({
        value: `${path}#${tool}`,
        label: `⚙ ${path} › ${tool}${mount.authDetected ? ' (auth detected)' : ''}`,
        selected: !mount.authDetected && !looksLoginGated(tool),
      });
    }
  }
  if (findings.openApiFound) {
    const path = served('/openapi.json');
    choices.push({ value: path, label: `○ ${path} — OpenAPI doc`, selected: true });
  }
  return choices;
}

/** The built-in floor paths, for the human-readable gating summary. */
const FLOOR_SUMMARY = '/api/auth/** & /api/webhooks/**';

/**
 * Runs the gating question. The user declares what is **public** — the shorter, safer list, since
 * most real APIs sit behind a login — and everything left unselected is treated as gated: gated
 * whole surfaces land in `gatedPaths`, individually gated tools in `gatedTools`, and a mount whose
 * tools are all gated collapses to its path. Pressing Enter accepts the heuristic pre-selection
 * (everything public except what looks login-gated — see `publicSurfaceChoices`). The built-in
 * auth/webhook floor is always composed in; never advertising an auth wall as open is a safety
 * invariant, not a toggle. Prints a plain-language summary of the decision.
 */
async function askGating(
  prompter: Prompter,
  findings: InitFindings,
  stdout: (line: string) => void,
): Promise<GatingAnswer> {
  const choices = publicSurfaceChoices(findings);
  if (choices.length === 0) return { floorKept: true, gatedPaths: [], gatedTools: [] };

  const preDeselected = choices.filter((choice) => !choice.selected).length;
  const question =
    "Which of these agent surfaces DON'T require logging in? Press Enter if none require " +
    'logging in; otherwise select the tools that are publicly available — anything left ' +
    'unselected is treated as login-gated and never advertised as open.' +
    (preDeselected > 0
      ? ` (ax pre-deselected ${preDeselected} that look${preDeselected === 1 ? 's' : ''} ` +
        'login-gated — adjust if that guess is wrong.)'
      : '');
  const publicValues = new Set(await prompter.multiSelect(question, choices));

  const gatedPaths: string[] = [];
  const gatedTools: string[] = [];
  const publicLabels: string[] = [];
  const gatedLabels: string[] = [];
  const served = (pathname: string): string => servedPath(findings.basePath, pathname);

  for (const mount of findings.mcpMounts) {
    const path = served(mount.pathname);
    if (mount.tools.length === 0) {
      if (publicValues.has(path)) publicLabels.push(path);
      else {
        gatedPaths.push(path);
        gatedLabels.push(path);
      }
      continue;
    }
    const gatedNames = mount.tools.filter((tool) => !publicValues.has(`${path}#${tool}`));
    if (gatedNames.length === mount.tools.length) {
      // Nothing on the mount is public → gate the whole surface; a simpler config, same effect.
      gatedPaths.push(path);
      gatedLabels.push(`${path} (all tools)`);
      continue;
    }
    for (const tool of mount.tools) {
      if (gatedNames.includes(tool)) {
        gatedTools.push(`${path}#${tool}`);
        gatedLabels.push(`${path} › ${tool}`);
      } else {
        publicLabels.push(`${path} › ${tool}`);
      }
    }
  }
  if (findings.openApiFound) {
    const path = served('/openapi.json');
    if (publicValues.has(path)) publicLabels.push(path);
    else {
      gatedPaths.push(path);
      gatedLabels.push(path);
    }
  }

  stdout(
    `[ax]   Public (advertised to agents): ${publicLabels.length > 0 ? publicLabels.join(', ') : 'none'}`,
  );
  stdout(
    `[ax]   Requires login (not advertised as open): ${
      gatedLabels.length > 0
        ? `${gatedLabels.join(', ')}, plus the built-in ${FLOOR_SUMMARY} floor`
        : `the built-in ${FLOOR_SUMMARY} floor`
    }`,
  );
  return { floorKept: true, gatedPaths, gatedTools };
}

/**
 * Asks the questions the source tree can't answer, each with a default. Returns undefined only when
 * a required answer (a valid siteUrl) couldn't be obtained after several tries.
 */
async function collectInteractive(
  prompter: Prompter,
  findings: InitFindings,
  siteUrlDefault: SiteUrlDefault,
  stdout: (line: string) => void,
): Promise<InitAnswers | undefined> {
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

  const gating = await askGating(prompter, findings, stdout);

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
    // Non-interactive applies every default: scaffolds and report on (yes-when-asked), and the
    // gating floor kept with no extra surfaces (so `isGated` is omitted — the floor is the default).
    const answers: InitAnswers = {
      siteUrl: validated.value,
      scaffoldLlmsTxt: true,
      scaffoldJsonLd: true,
      scaffoldRobots: true,
      scaffoldAgent404: true,
      report: true,
      gating: { floorKept: true, gatedPaths: [], gatedTools: [] },
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
    const answers = await collectInteractive(
      prompter,
      findings,
      detectSiteUrlDefault(args.siteUrl),
      stdout,
    );
    if (answers === undefined) {
      stderr('[ax] No valid site URL provided — aborting without writing anything.');
      return 1;
    }

    const fileName = writeConfigAndWire(cwd, answers, stdout);

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
