import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findAppDir, listStaticPageRoutes } from './app-dir.js';
import { catalogServedPath } from './discovery.js';

// Agent-aware 404. When an AI agent fetches a URL that doesn't exist, a default 404 page is a
// dead end: the agent either gives up or hallucinates a next step. Mintlify's crawl benchmark
// found that a single llms.txt link on error responses eliminates most agent 404 dead-ends, and
// Vercel's agent-readability guidance recommends signposting llms.txt from every response. This
// module applies that to the Next.js 404 path:
//
//   - Detect `app/not-found.*`; when present, check (textually) whether it carries any agent
//     signposts (llms.txt / ai-catalog); recommend adding them when it doesn't.
//   - Opt-in (`scaffoldAgent404: true`): scaffold an agent-aware `app/not-found.tsx` ONCE (the
//     file is the user's — never overwritten), importing a small data module
//     (`app/not-found-agent-data.*`) that IS regenerated on every run with the app's current
//     static route list and discovery links. The route manifest is the part only a build-time
//     tool can supply: at runtime nothing knows the route table, but the source tree does.
//
// The scaffolded page explains to agents why the 404 happened (the URL doesn't exist — don't
// retry), and how to continue (the site's discovery artifacts + real routes), both as visible
// text an agent reading HTML will parse and as a schema.org ItemList in JSON-LD.

/** Cap on routes embedded in the data module — a navigation aid, not a sitemap replacement. */
const MAX_ROUTES = 50;

/** Base name (sans extension) of the regenerated data module the scaffolded page imports. */
const DATA_MODULE_BASE = 'not-found-agent-data';

const NOT_FOUND_FILE_NAMES = ['not-found.tsx', 'not-found.jsx', 'not-found.js'];

/** Signals that an existing not-found page already points agents somewhere useful. */
const AGENT_SIGNPOST_RE = /llms\.txt|ai-catalog|agentGuidance/;

export interface Agent404Options {
  cwd: string;
  /** `ard.config` `scaffoldAgent404`, resolved. Opt-in — defaults to `false`. */
  scaffold: boolean;
  /** `next.config` `basePath`, or `''` if unset — discovery links are served under it. */
  basePath: string;
  /** Whether an llms.txt source was detected this run (drives which links the data module lists). */
  llmsTxtFound: boolean;
  /** Whether a sitemap source was detected this run. */
  sitemapFound: boolean;
  warn: (message: string) => void;
  recommend: (message: string) => void;
}

export interface Agent404Result {
  /** Whether an `app/not-found.*` exists (after any scaffolding this run performed). */
  notFoundPresent: boolean;
  /** The not-found source path relative to the project root, if present. */
  source?: string;
  /** Whether the page carries agent signposts (llms.txt / ai-catalog links). */
  agentAware: boolean;
  /** Path of the not-found page scaffolded on *this* run, if any. */
  scaffoldedPath?: string;
  /** Path of the regenerated route-manifest data module, if written this run. */
  dataModulePath?: string;
}

/**
 * Detect-and-recommend (and, opted in, scaffold) for an agent-aware 404 page. Never overwrites the
 * user's `not-found.*`; only the generated data module is rewritten on every run, and only once a
 * scaffolded (or signpost-aware) page exists to import it. Any filesystem error warns rather than
 * throws — a helpful extra file must never be why a build breaks.
 */
export function manageAgent404(options: Agent404Options): Agent404Result {
  const { cwd, warn, recommend } = options;
  const appDir = findAppDir(cwd);
  if (!appDir) return { notFoundPresent: false, agentAware: false };

  const notFoundFile = NOT_FOUND_FILE_NAMES.map((name) => join(appDir, name)).find((path) =>
    existsSync(path),
  );

  if (notFoundFile) {
    const source = relative(cwd, notFoundFile);
    const agentAware = fileMentionsSignposts(notFoundFile);

    if (agentAware) {
      // A previously-scaffolded (or hand-built) agent-aware page: keep its route manifest fresh
      // when it imports our data module and scaffolding is (still) opted in.
      const dataModulePath =
        options.scaffold && fileImportsDataModule(notFoundFile)
          ? writeDataModule(appDir, options)
          : undefined;
      return {
        notFoundPresent: true,
        source,
        agentAware: true,
        ...(dataModulePath !== undefined ? { dataModulePath } : {}),
      };
    }

    recommend(
      `${source} exists but doesn't point agents anywhere — an agent hitting a 404 needs to know ` +
        'why (the URL doesn’t exist; retrying won’t help) and how to continue. Add links to your ' +
        `llms.txt and ${catalogServedPath(options.basePath)} plus a short list of real routes ` +
        '(visible text is enough; agents read the HTML). ax won’t touch your not-found ' +
        'page once you have one.',
    );
    return { notFoundPresent: true, source, agentAware: false };
  }

  if (!options.scaffold) {
    recommend(
      'No app/not-found.tsx found — agents that hit a missing URL get Next.js’s bare default 404, ' +
        'a dead end that makes them give up or guess. Add one that tells agents why the 404 ' +
        'happened and how to continue (links to llms.txt, the ai-catalog, and your real routes), ' +
        'or set scaffoldAgent404: true in ard.config to have an agent-aware page (plus a ' +
        'build-time route manifest) written for you.',
    );
    return { notFoundPresent: false, agentAware: false };
  }

  const scaffolded = scaffoldNotFound(cwd, appDir, options);
  if (!scaffolded) return { notFoundPresent: false, agentAware: false };

  const dataModulePath = writeDataModule(appDir, options);
  warn(
    `Scaffolded an agent-aware 404 page at ${relative(cwd, scaffolded)} — edit it freely (it's ` +
      `yours; ax never overwrites it). Its imported ${DATA_MODULE_BASE} module is ` +
      'regenerated on every build so the route list and discovery links stay fresh.',
  );
  return {
    notFoundPresent: true,
    source: relative(cwd, scaffolded),
    agentAware: true,
    scaffoldedPath: scaffolded,
    ...(dataModulePath !== undefined ? { dataModulePath } : {}),
  };
}

function fileMentionsSignposts(path: string): boolean {
  try {
    return AGENT_SIGNPOST_RE.test(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
}

function fileImportsDataModule(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(DATA_MODULE_BASE);
  } catch {
    return false;
  }
}

/** The discovery links the data module lists — only artifacts that actually exist this run. */
function discoveryLinks(options: Agent404Options): Array<{ url: string; purpose: string }> {
  const prefix = options.basePath === '/' ? '' : options.basePath.replace(/\/$/, '');
  const links = [
    {
      url: catalogServedPath(options.basePath),
      purpose: 'machine-readable catalog of everything this site offers agents (AI Catalog / ARD)',
    },
  ];
  if (options.llmsTxtFound) {
    links.push({
      url: `${prefix}/llms.txt`,
      purpose: 'what this site is for and its key pages, in plain language',
    });
  }
  if (options.sitemapFound) {
    links.push({ url: `${prefix}/sitemap.xml`, purpose: 'every public URL on this site' });
  }
  return links;
}

/**
 * Regenerates the data module (`app/not-found-agent-data.{ts,js}`) with the current static route
 * list and discovery links. Generated output, clearly marked, rewritten every run — the same
 * contract as the `emit: 'route'` handlers.
 */
function writeDataModule(appDir: string, options: Agent404Options): string | undefined {
  const useTypeScript = existsSync(join(options.cwd, 'tsconfig.json'));
  const filePath = join(appDir, `${DATA_MODULE_BASE}.${useTypeScript ? 'ts' : 'js'}`);

  const routes = listStaticPageRoutes(appDir).slice(0, MAX_ROUTES);
  const payload = { discovery: discoveryLinks(options), routes };

  const source =
    `// Generated by ax (scaffoldAgent404). Do not edit by hand — regenerated on every\n` +
    `// build so the 404 page's route list and discovery links stay current.\n` +
    `export const agentGuidance = ${JSON.stringify(payload, null, 2)}${useTypeScript ? ' as const' : ''};\n`;

  try {
    writeFileSync(filePath, source, 'utf8');
  } catch (err) {
    options.warn(
      `Tried to write the 404 route manifest at ${filePath} but couldn't (${(err as Error).message}).`,
    );
    return undefined;
  }
  return filePath;
}

/** Scaffolds `app/not-found.{tsx,jsx}` once. Never overwrites; warns instead of throwing. */
function scaffoldNotFound(
  cwd: string,
  appDir: string,
  options: Agent404Options,
): string | undefined {
  const useTypeScript = existsSync(join(cwd, 'tsconfig.json'));
  const filePath = join(appDir, useTypeScript ? 'not-found.tsx' : 'not-found.jsx');

  try {
    if (existsSync(filePath)) return undefined;
    mkdirSync(appDir, { recursive: true });
    writeFileSync(filePath, notFoundSource(), 'utf8');
  } catch (err) {
    options.warn(
      `Tried to scaffold an agent-aware 404 page at ${filePath} but couldn't (${(err as Error).message}).`,
    );
    return undefined;
  }
  return filePath;
}

/**
 * The scaffolded page source. Valid as both `.tsx` and `.jsx` (no type annotations needed). The
 * agent guidance is ordinary visible HTML — agents read the page text — plus a schema.org
 * ItemList in JSON-LD for structured-data readers. Human visitors see a normal 404 with helpful
 * links; there is nothing to hide from either audience.
 */
function notFoundSource(): string {
  return `// Agent-aware 404, scaffolded by ax (scaffoldAgent404). This file is yours:
// edit it freely, ax never overwrites it. The ./${DATA_MODULE_BASE} import IS
// regenerated on every build (current routes + discovery links) — keep importing it and your
// 404 page never goes stale.
import { agentGuidance } from './${DATA_MODULE_BASE}';

export default function NotFound() {
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Page not found',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: agentGuidance.routes.map((route, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: route,
      })),
    },
  };

  return (
    <main>
      <h1>404 — page not found</h1>
      <p>
        This URL does not exist on this site. It may have moved, or it may never have existed —
        requesting it again will keep returning 404.
      </p>

      <section aria-labelledby="agent-guidance">
        <h2 id="agent-guidance">If you are an AI agent</h2>
        <p>Do not retry this URL. To find what you were looking for, start from:</p>
        <ul>
          {agentGuidance.discovery.map((link) => (
            <li key={link.url}>
              <a href={link.url}>{link.url}</a> — {link.purpose}
            </li>
          ))}
        </ul>
        <h2>Pages that do exist</h2>
        <ul>
          {agentGuidance.routes.map((route) => (
            <li key={route}>
              <a href={route}>{route}</a>
            </li>
          ))}
        </ul>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />
    </main>
  );
}
`;
}
