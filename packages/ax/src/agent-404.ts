import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { catalogServedPath } from './discovery.js';
import { buildRouterModel, type RouterModel } from './router-model.js';

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
//
// The 404 convention differs by router: the App Router's is `app/not-found.*`, the Pages Router's
// is `pages/404.*`. The component and its regenerated data module are otherwise identical, so only
// the target directory and file name change — resolved once from the primary router.

/** Cap on routes embedded in the data module — a navigation aid, not a sitemap replacement. */
const MAX_ROUTES = 50;

/** Base name (sans extension) of the regenerated data module the scaffolded page imports. */
const DATA_MODULE_BASE = 'not-found-agent-data';

/** Signals that an existing not-found page already points agents somewhere useful. */
const AGENT_SIGNPOST_RE = /llms\.txt|ai-catalog|agentGuidance/;

/** Where the 404 page lives and what it's named, per router convention. */
interface NotFoundTarget {
  /** The router directory the 404 page and its data module live in. */
  dir: string;
  /** Existing 404-page file names to detect, across the extensions that render one. */
  detectNames: string[];
  /** Base name (sans extension) of the page ax scaffolds. */
  scaffoldBase: string;
}

/**
 * The 404 target for the primary router: `app/not-found.*` for an App Router app, `pages/404.*` for
 * a Pages Router app. Undefined when the project has neither router.
 */
function notFoundTarget(router: RouterModel): NotFoundTarget | undefined {
  if (router.primary === 'app' && router.appDir) {
    return {
      dir: router.appDir,
      detectNames: ['not-found.tsx', 'not-found.jsx', 'not-found.js'],
      scaffoldBase: 'not-found',
    };
  }
  if (router.primary === 'pages' && router.pagesDir) {
    return {
      dir: router.pagesDir,
      detectNames: ['404.tsx', '404.jsx', '404.js'],
      scaffoldBase: '404',
    };
  }
  return undefined;
}

export interface Agent404Options {
  cwd: string;
  /** `ax.config` `scaffoldAgent404`, resolved. Opt-in — defaults to `false`. */
  scaffold: boolean;
  /** `next.config` `basePath`, or `''` if unset — discovery links are served under it. */
  basePath: string;
  /** Whether an llms.txt source was detected this run (drives which links the data module lists). */
  llmsTxtFound: boolean;
  /** Whether a sitemap source was detected this run. */
  sitemapFound: boolean;
  warn: (message: string) => void;
  recommend: (message: string) => void;
  /** The shared router model. Built from `cwd` when omitted, so the detector runs standalone. */
  router?: RouterModel;
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
  const router = options.router ?? buildRouterModel(cwd);
  const target = notFoundTarget(router);
  if (!target) return { notFoundPresent: false, agentAware: false };

  const notFoundFile = target.detectNames
    .map((name) => join(target.dir, name))
    .find((path) => existsSync(path));

  if (notFoundFile) {
    const source = relative(cwd, notFoundFile);
    const agentAware = fileMentionsSignposts(notFoundFile);

    if (agentAware) {
      // A previously-scaffolded (or hand-built) agent-aware page: keep its route manifest fresh
      // when it imports our data module and scaffolding is (still) opted in.
      const dataModulePath =
        options.scaffold && fileImportsDataModule(notFoundFile)
          ? writeDataModule(target.dir, options, router)
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
    const conventionPath = `${relative(cwd, target.dir)}/${target.scaffoldBase}.tsx`;
    recommend(
      `No ${conventionPath} found — agents that hit a missing URL get Next.js’s bare default 404, ` +
        'a dead end that makes them give up or guess. Add one that tells agents why the 404 ' +
        'happened and how to continue (links to llms.txt, the ai-catalog, and your real routes), ' +
        'or set scaffoldAgent404: true in ax.config to have an agent-aware page (plus a ' +
        'build-time route manifest) written for you.',
    );
    return { notFoundPresent: false, agentAware: false };
  }

  const scaffolded = scaffoldNotFound(cwd, target, options);
  if (!scaffolded) return { notFoundPresent: false, agentAware: false };

  const dataModulePath = writeDataModule(target.dir, options, router);
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
 * Regenerates the data module (`not-found-agent-data.{ts,js}`, beside the 404 page) with the current
 * static route list and discovery links. Generated output, clearly marked, rewritten every run — the
 * same contract as the `emit: 'route'` handlers. Routes span both routers (`router.listPageRoutes`).
 */
function writeDataModule(
  dir: string,
  options: Agent404Options,
  router: RouterModel,
): string | undefined {
  const useTypeScript = existsSync(join(options.cwd, 'tsconfig.json'));
  const filePath = join(dir, `${DATA_MODULE_BASE}.${useTypeScript ? 'ts' : 'js'}`);

  const routes = router.listPageRoutes().slice(0, MAX_ROUTES);
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

/**
 * Scaffolds the 404 page once into the primary router (`app/not-found.{tsx,jsx}` or
 * `pages/404.{tsx,jsx}`). Never overwrites; warns instead of throwing. The component source is
 * identical across routers — both default-export a React component that imports the data module.
 */
function scaffoldNotFound(
  cwd: string,
  target: NotFoundTarget,
  options: Agent404Options,
): string | undefined {
  const useTypeScript = existsSync(join(cwd, 'tsconfig.json'));
  const filePath = join(target.dir, `${target.scaffoldBase}.${useTypeScript ? 'tsx' : 'jsx'}`);

  try {
    if (existsSync(filePath)) return undefined;
    mkdirSync(target.dir, { recursive: true });
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
