import { readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findAppDir, resolvePagePathname } from './app-dir.js';
import { scrubSource } from './scrub-source.js';
import { buildArtifactUrl, buildUrn, NO_SITE_URL_HINT } from './site-url.js';
import type { CatalogEntry } from './types.js';
import { DEFAULT_IGNORED_DIRS, walkFiles } from './walk-files.js';

// WebMCP (W3C Web Machine Learning CG draft) lets a page register in-page tools a browser-resident
// agent can call. Two registration styles exist, and they differ sharply in what a static scan —
// this plugin's, or an external scanner reading server-rendered HTML — can see:
//
//   - Declarative: `<form toolname="..." tooldescription="...">`. Lives in markup, so it survives
//     into server-rendered HTML and is exactly what HTML-reading scanners (including Ora's `webmcp`
//     check) detect.
//   - Imperative: `document.modelContext.registerTool(...)` in a client component (or the
//     `useWebMCP()` hook from `@mcp-b/react-webmcp` / `usewebmcp`). Runtime-only — invisible in
//     server-rendered HTML, so scanners can't see these tools statically.
//
// Detection here is deliberately textual, not AST-based, matching detect-mcp.ts. Anchoring on the
// `modelContext` receiver (or the hook's import + call pair) keeps a user-defined function that
// happens to be named `registerTool` from matching, but on its own it says nothing about whether
// the text is *code*. Three further guards do that work, and they are what keep prose and comments
// out of the emitted catalog:
//
//   1. Every scan below runs against `scrubSource(content)` (see scrub-source.ts): comment bodies
//      and template-literal contents are blanked to spaces, with offsets and line numbers intact.
//      Ordinary '...'/"..." strings are left alone — that is where tool names and JSX attribute
//      values live.
//   2. A per-line unclosed-quote check (`insideStringLiteral`) drops matches sitting inside such a
//      string: a metadata description or a log message mentioning the API is a mention, not a call.
//   3. The call regexes require a non-empty argument list. Rendered prose like "register tools with
//      navigator.modelContext.registerTool()." reads as a call to a regex but registers nothing, so
//      requiring an argument removes it without costing a single real registration.
//
// The result is lexer-grade, not AST-grade: scrub-source.ts documents where the heuristics stop.
//
// One API-churn note this detector encodes: the WebMCP entry point moved from
// `navigator.modelContext` to `document.modelContext` in the May 2026 draft, and Chrome 150+
// deprecates the `navigator` alias — so `navigator.modelContext` usage is detected but warned about.

/**
 * `modelContext.registerTool(...)` / `modelContext.provideContext(...)` behind a known receiver.
 * The trailing `(?!\s*\))` requires an actual argument: a registration with an empty argument list
 * registers nothing, so the only things that shape matches are prose and pseudo-code. (The
 * whitespace lives inside the lookahead on purpose — a `\s*` before it would just backtrack.)
 */
const IMPERATIVE_RE =
  /\b(document|navigator|window)\s*\.\s*modelContext\s*\.\s*(registerTool|provideContext)\s*\((?!\s*\))/g;

// The `useWebMCP()` hook needs both textual signals — the import and the call — mirroring the
// two-signal rule detect-mcp.ts uses, so a user-defined hook with the same name never matches.
const HOOK_IMPORT_RE = /from\s+['"](?:@mcp-b\/react-webmcp|usewebmcp)['"]/;
const HOOK_CALL_RE = /\buseWebMCP\s*\((?!\s*\))/g;

/**
 * A declarative WebMCP form: `<form ... toolname="...">`. Handles the three JSX attribute value
 * shapes that stay statically readable (double-quoted, single-quoted, `{'literal'}`); an attribute
 * computed at runtime is not statically knowable and deliberately doesn't match.
 */
const DECLARATIVE_FORM_RE =
  /<form\b[^>]*\btoolname\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*['"`]([^'"`]+)['"`]\s*\})/g;

/** Any `<form` at all — for the "every form is a latent WebMCP tool" recommendation. */
const ANY_FORM_RE = /<form[\s>]/;

const TOOL_DESCRIPTION_ATTR_RE = /\btooldescription\s*=/;

/** Cap on how far `formTagText` looks for a form tag's closing `>`. */
const FORM_TAG_WINDOW = 2000;

/** `name: '...'` inside a registerTool/provideContext/useWebMCP argument window. */
const TOOL_NAME_PROP_RE = /\bname\s*:\s*['"`]([^'"`]+)['"`]/g;

/** How far past a call site to look for literal `name:` properties (best-effort, never invents). */
const CALL_SITE_WINDOW = 1500;

const SOURCE_FILE_RE = /\.(?:tsx|jsx|ts|js|mjs|cjs)$/;

/**
 * The `'use client'` directive as an actual leading statement: only whitespace and comments may
 * precede it (Next.js's own rule). A plain substring search is not enough — a *comment* mentioning
 * 'use client' (as this repo's own server-component fixture does) must not count.
 */
const USE_CLIENT_RE = /^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(['"])use client\1/;

/** npm packages whose presence in package.json signals WebMCP intent (MCP-B polyfill/DX layer). */
const WEBMCP_PACKAGE_PREFIXES = ['@mcp-b/', 'usewebmcp'];

export interface WebMcpToolSite {
  /** Source file, relative to `cwd`. */
  source: string;
  kind: 'imperative' | 'hook' | 'declarative';
  /** Statically-extracted tool names (literal strings only — never inferred). */
  names: string[];
  /** Imperative only: the receiver used (`navigator` means the deprecated pre-May-2026 alias). */
  receiver?: 'document' | 'navigator' | 'window';
  /** Imperative/hook in a file with no 'use client' directive — likely never runs in the browser. */
  missingUseClient?: boolean;
  /** Declarative only: the page URL path, when the file is an App Router page with static segments. */
  pagePathname?: string;
}

export interface DetectWebMcpOptions {
  cwd: string;
  /** Absolute site origin (see site-url.ts), or undefined if none could be determined. */
  siteUrl: string | undefined;
  /** `next.config` `basePath`, or `''` if unset. */
  basePath: string;
  /** Reported via `generateCatalog`'s `onWarning` — never thrown, this detector never fails a build. */
  warn: (message: string) => void;
  /** Advisory recommendation channel (not a warning — nothing is broken). */
  recommend: (message: string) => void;
}

export interface DetectWebMcpResult {
  sites: WebMcpToolSite[];
  /** One `text/html` entry per page whose declarative tools resolved to a stable URL. */
  entries: CatalogEntry[];
  /** Distinct tool names across every site that can actually run (browser-reachable). */
  toolNames: string[];
}

/**
 * Detects in-page WebMCP tools — declarative `<form toolname>` markup, imperative
 * `document.modelContext.registerTool()` calls, and `useWebMCP()` hook usage — across the project's
 * source files. Declarative tools on statically-resolvable App Router pages become `text/html`
 * catalog entries (the page is a real, addressable artifact; its `capabilities` carry the tool
 * names). Imperative tools are runtime-only with no spec-defined manifest to reference, so they are
 * surfaced through warnings/recommendations instead of invented catalog entries — spec follower,
 * never spec inventor.
 */
export function detectWebMcp(options: DetectWebMcpOptions): DetectWebMcpResult {
  const { cwd, warn, recommend } = options;

  // `public/` is excluded on top of the default ignores: bundled/vendored assets there aren't the
  // app's own source, and minified bundles are exactly where textual matching would false-positive.
  const ignoredDirs = new Set([...DEFAULT_IGNORED_DIRS, 'public']);
  const files = walkFiles(cwd, (name) => SOURCE_FILE_RE.test(name), ignoredDirs);

  const appDir = findAppDir(cwd);
  const sites: WebMcpToolSite[] = [];
  let sawAnyForm = false;

  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }
    // Every pattern scan below reads the scrubbed copy so comments and template-literal contents
    // can't register anything. `USE_CLIENT_RE` is the one exception: it runs on the raw text
    // because it has its own rule about which comments may precede the directive.
    const content = scrubSource(raw);

    const source = relative(cwd, file.absolutePath);
    if (ANY_FORM_RE.test(content)) sawAnyForm = true;

    const declarative = scanDeclarative(content, file.absolutePath, appDir);
    if (declarative) {
      sites.push({ ...declarative.site, source });
      if (declarative.missingDescription.length > 0) {
        recommend(
          `${source} declares <form toolname> without a tooldescription attribute ` +
            `(${declarative.missingDescription.join(', ')}) — the description is what tells an ` +
            'agent when to call the tool (and HTML scanners like Ora’s webmcp check look for both ' +
            'attributes). Add tooldescription to every toolname form.',
        );
      }
    }

    const imperative = scanImperative(content);
    if (imperative) {
      const missingUseClient = !USE_CLIENT_RE.test(raw);
      sites.push({ kind: 'imperative', source, missingUseClient, ...imperative });

      if (imperative.receiver === 'navigator') {
        warn(
          `${source} registers WebMCP tools via navigator.modelContext — deprecated since the ` +
            'May 2026 draft moved the entry point to document.modelContext (Chrome 150+ deprecates ' +
            'the navigator alias). Switch to document.modelContext, or use a polyfill like ' +
            '@mcp-b/global that installs both.',
        );
      }
      if (missingUseClient) {
        warn(
          `${source} registers WebMCP tools but has no 'use client' directive — in a server ` +
            'component document/navigator don’t exist, so the registration can never run in the ' +
            'browser and the tools were NOT counted. Move the registration into a client component.',
        );
      }
    }

    if (HOOK_IMPORT_RE.test(content) && HOOK_CALL_RE.test(content)) {
      sites.push({
        kind: 'hook',
        source,
        names: extractNamesNearCalls(content, HOOK_CALL_RE),
        missingUseClient: !USE_CLIENT_RE.test(raw),
      });
    }
  }

  const entries = buildDeclarativeEntries(sites, options);
  const toolNames = distinctReachableToolNames(sites);

  emitSummaryRecommendations({ sites, toolNames, sawAnyForm, cwd, recommend });

  return { sites, entries, toolNames };
}

interface DeclarativeScan {
  site: Omit<WebMcpToolSite, 'source'>;
  /** Tool names whose own `<form>` tag carries no `tooldescription` attribute. */
  missingDescription: string[];
}

/** Declarative scan of one file: toolname values, plus the page pathname when resolvable. */
function scanDeclarative(
  content: string,
  absolutePath: string,
  appDir: string | undefined,
): DeclarativeScan | undefined {
  const names: string[] = [];
  const missingDescription: string[] = [];
  for (const match of content.matchAll(DECLARATIVE_FORM_RE)) {
    // A `<form toolname=...>` that sits inside a string literal (a metadata description, a log
    // message, docs prose) is a *mention*, not markup — skip it. Cheap textual guard: an unclosed
    // quote between the start of the line and the `<form` means we're inside a string.
    const index = match.index ?? 0;
    if (insideStringLiteral(content, index)) continue;
    const name = match[1] ?? match[2] ?? match[3];
    if (name === undefined || names.includes(name)) continue;
    names.push(name);
    // Scoped to this form's own tag: one compliant form elsewhere in the file says nothing about
    // whether *this* one is described.
    if (!TOOL_DESCRIPTION_ATTR_RE.test(formTagText(content, index))) missingDescription.push(name);
  }
  if (names.length === 0) return undefined;

  return {
    site: { kind: 'declarative', names, pagePathname: resolvePagePathname(absolutePath, appDir) },
    missingDescription,
  };
}

/**
 * The text of the `<form ...>` opening tag starting at `index`. Scans to the `>` that closes the
 * tag, stepping over quoted attribute values and `{...}` JSX expressions so an arrow function in an
 * `onSubmit` handler doesn't end the tag early. Falls back to a bounded window if no `>` turns up.
 */
function formTagText(content: string, index: number): string {
  let depth = 0;
  for (let i = index; i < content.length && i < index + FORM_TAG_WINDOW; i++) {
    const char = content[i];
    if (char === '"' || char === "'") {
      const close = content.indexOf(char, i + 1);
      if (close === -1) break;
      i = close;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === '>' && depth === 0) return content.slice(index, i + 1);
  }
  return content.slice(index, index + FORM_TAG_WINDOW);
}

/** Imperative scan of one file: receiver used and tool names near each call site. */
function scanImperative(content: string): Pick<WebMcpToolSite, 'names' | 'receiver'> | undefined {
  IMPERATIVE_RE.lastIndex = 0;
  let receiver: WebMcpToolSite['receiver'];
  const names: string[] = [];

  for (const match of content.matchAll(IMPERATIVE_RE)) {
    // Same guard the declarative scan uses: a registration quoted inside a string (a page's
    // `metadata.description`, an error message, a docs snippet) is a mention, not a call.
    if (insideStringLiteral(content, match.index ?? 0)) continue;
    const matchedReceiver = match[1] as 'document' | 'navigator' | 'window';
    // `navigator` (the deprecated alias) wins the reported receiver so the deprecation warning
    // fires even in files that use both forms during a migration.
    if (receiver !== 'navigator') receiver = matchedReceiver;
    for (const name of extractNamesInWindow(content, match.index ?? 0)) {
      if (!names.includes(name)) names.push(name);
    }
  }

  return receiver === undefined ? undefined : { names, receiver };
}

/**
 * Whether `index` sits inside a string literal, judged from the start of its line: an odd count of
 * any unescaped quote kind before the match means an unclosed string. Line-scoped, and that is
 * enough here only because callers pass scrubbed source (see scrub-source.ts): a `<form toolname>`
 * or a registration spread across a *multi-line* template literal has already been blanked out, so
 * this guard is left with the single-line `'...'` / `"..."` case it can actually judge.
 */
function insideStringLiteral(content: string, index: number): boolean {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const prefix = content.slice(lineStart, index);
  for (const quote of ["'", '"', '`']) {
    let count = 0;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] === quote && prefix[i - 1] !== '\\') count++;
    }
    if (count % 2 === 1) return true;
  }
  return false;
}

/** Literal `name:` strings within a fixed window after `index` — best-effort, never invents. */
function extractNamesInWindow(content: string, index: number): string[] {
  const window = content.slice(index, index + CALL_SITE_WINDOW);
  const names: string[] = [];
  for (const match of window.matchAll(TOOL_NAME_PROP_RE)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

function extractNamesNearCalls(content: string, callRe: RegExp): string[] {
  callRe.lastIndex = 0;
  const names: string[] = [];
  for (const match of content.matchAll(callRe)) {
    for (const name of extractNamesInWindow(content, match.index ?? 0)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** One `text/html` entry per page whose declarative tools resolved to a stable URL. */
function buildDeclarativeEntries(
  sites: WebMcpToolSite[],
  options: DetectWebMcpOptions,
): CatalogEntry[] {
  const pages = sites.filter(
    (site): site is WebMcpToolSite & { pagePathname: string } =>
      site.kind === 'declarative' && site.pagePathname !== undefined,
  );
  if (pages.length === 0) return [];

  if (!options.siteUrl) {
    options.warn(
      `Found declarative WebMCP tools on ${pages.length} page${pages.length === 1 ? '' : 's'} but ` +
        `no site URL is known — ${NO_SITE_URL_HINT}`,
    );
    return [];
  }
  const siteUrl = options.siteUrl;

  return pages.map((site): CatalogEntry => {
    const isRoot = site.pagePathname === '/';
    return {
      identifier: isRoot
        ? buildUrn(siteUrl, 'webmcp')
        : buildUrn(siteUrl, 'webmcp', site.pagePathname),
      type: 'text/html',
      displayName: `WebMCP tools (${site.pagePathname})`,
      description:
        'Page registering in-page WebMCP tools via declarative <form toolname> attributes ' +
        '(W3C WebMCP draft) — callable by browser-resident agents.',
      url: buildArtifactUrl(siteUrl, options.basePath, site.pagePathname),
      updatedAt: mtimeIso(options.cwd, site.source),
      capabilities: site.names,
    };
  });
}

function mtimeIso(cwd: string, source: string): string {
  return statSync(join(cwd, source)).mtime.toISOString();
}

/** Tool names from sites that can actually run in a browser (declarative, or client-side JS). */
function distinctReachableToolNames(sites: WebMcpToolSite[]): string[] {
  const names: string[] = [];
  for (const site of sites) {
    if (site.kind !== 'declarative' && site.missingUseClient) continue;
    for (const name of site.names) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

interface SummaryOptions {
  sites: WebMcpToolSite[];
  toolNames: string[];
  sawAnyForm: boolean;
  cwd: string;
  recommend: (message: string) => void;
}

function emitSummaryRecommendations(options: SummaryOptions): void {
  const { sites, sawAnyForm, cwd, recommend } = options;

  const runtimeOnly = sites.filter((site) => site.kind !== 'declarative' && !site.missingUseClient);
  if (runtimeOnly.length > 0) {
    const names = runtimeOnly.flatMap((site) => site.names);
    recommend(
      `${names.length || runtimeOnly.length} in-page WebMCP tool${names.length === 1 ? '' : 's'} ` +
        `registered imperatively${names.length > 0 ? ` (${names.join(', ')})` : ''} — imperative ` +
        'registrations run only in the browser, so they are invisible in server-rendered HTML and ' +
        'to HTML-reading scanners (including Ora’s webmcp check). Where a tool wraps a form ' +
        'submission, mirror it declaratively with <form toolname="..." tooldescription="..."> so ' +
        'it is detectable in markup too.',
    );
  }

  const hasAnyWebMcp = sites.length > 0;
  const webMcpDeps = readWebMcpDependencies(cwd);

  if (!hasAnyWebMcp && webMcpDeps.length > 0) {
    recommend(
      `package.json depends on ${webMcpDeps.join(', ')} but no WebMCP tool registration was ` +
        'detected in your source — if the dependency is intentional, register tools via ' +
        "document.modelContext.registerTool() in a 'use client' component (or the useWebMCP hook), " +
        'or remove the unused dependency.',
    );
    return;
  }

  if (!hasAnyWebMcp && sawAnyForm) {
    recommend(
      'No WebMCP tools found, but your pages contain <form> elements — every form is a latent ' +
        'agent tool. Adding toolname and tooldescription attributes (the W3C WebMCP declarative ' +
        'API) makes a form callable by browser-resident agents with no JS changes, and is scored ' +
        'by Ora’s webmcp check. Chrome ships WebMCP in 157 (origin trial 149–156).',
    );
  }
}

/** WebMCP-related package names found in the project's package.json (deps + devDeps). */
function readWebMcpDependencies(cwd: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  const names = [
    ...Object.keys((record.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...Object.keys((record.devDependencies as Record<string, unknown> | undefined) ?? {}),
  ];
  return names.filter((name) =>
    WEBMCP_PACKAGE_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix)),
  );
}
