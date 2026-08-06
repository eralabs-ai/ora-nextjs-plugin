import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { RouterModel } from './router-model.js';
import type { SiteMetadata } from './site-metadata.js';

// The write side of JSON-LD structured data (`scaffoldJsonLd: true`). Structured data is how
// registries and agents identify a site as an *entity* they can disambiguate and rank, and the
// `Organization` block's skeleton — name, description, url — is mechanical: it's already in
// package.json and the resolved site URL. So ax writes that skeleton once, into its own component
// file, and stops there.
//
// Two deliberate limits:
//
//   - `sameAs` (the external profiles that actually do the disambiguating) is left empty with a
//     TODO. Those links live outside the repo; nothing at build time can derive them.
//   - The component is never wired into `app/layout.tsx` by ax. Editing the file every page of an
//     app renders through, to insert an element, is not a change a postbuild step should make
//     behind someone's back — so the CLI prints the exact import and element to add instead, and
//     the build report carries the same two strings for a coding agent to apply.

/** Base name (sans extension) of the scaffolded component. */
export const JSON_LD_COMPONENT_BASE = 'organization-json-ld';

/** Exported component name — used in the wiring instructions, so it has to match the source. */
const COMPONENT_NAME = 'OrganizationJsonLd';

/** Where the component is written and which file its wiring instructions point at, per router. */
interface ScaffoldTarget {
  dir: string;
  /** Base name (sans extension) of the file the developer adds the import/element to. */
  wiringFileBase: string;
}

/**
 * The scaffold target for the primary router: the App Router root wired via `layout`, or the Pages
 * Router root wired via `_app`. Undefined when the project has neither router.
 */
function scaffoldTarget(router: RouterModel): ScaffoldTarget | undefined {
  if (router.primary === 'app' && router.appDir) {
    return { dir: router.appDir, wiringFileBase: 'layout' };
  }
  if (router.primary === 'pages' && router.pagesDir) {
    return { dir: router.pagesDir, wiringFileBase: '_app' };
  }
  return undefined;
}

export type JsonLdScaffoldAction = 'created' | 'exists' | 'skipped';

/** The exact edit a developer (or their coding agent) applies to `app/layout.tsx`. */
export interface JsonLdWiring {
  /** e.g. `import { OrganizationJsonLd } from './organization-json-ld';` */
  importLine: string;
  /** e.g. `<OrganizationJsonLd />` */
  element: string;
  /** The layout file the edit belongs in, relative to the project root. */
  layoutPath: string;
}

export interface JsonLdScaffoldResult {
  action: JsonLdScaffoldAction;
  /** The component file, when one exists after this run (absolute path). */
  path?: string;
  /** How to publish the component. Present whenever a component exists but nothing renders it. */
  wiring?: JsonLdWiring;
  /** Why nothing was written, for `skipped`. */
  reason?: string;
}

export interface ScaffoldJsonLdOptions {
  cwd: string;
  /** The shared router model — the primary router decides where the component and its wiring go. */
  router: RouterModel;
  /** Resolved site origin. Absent means the `url` field is left as a TODO rather than guessed. */
  siteUrl?: string;
  /** `package.json` facts — the `name`/`description` the Organization block is built from. */
  site: SiteMetadata;
  warn: (message: string) => void;
}

/**
 * Writes an `organization-json-ld.{tsx,jsx}` component once into the primary router's directory, and
 * reports how to wire it up — into `app/layout.*` for an App Router app, or `pages/_app.*` for a
 * Pages Router app. Never overwrites (a second run returns `exists` with the same wiring
 * instructions, since an unimported component still isn't published), and never fails the build — a
 * filesystem error warns and returns `skipped`.
 */
export function scaffoldOrganizationJsonLd(options: ScaffoldJsonLdOptions): JsonLdScaffoldResult {
  const { router, cwd } = options;
  const target = scaffoldTarget(router);
  if (!target) {
    return {
      action: 'skipped',
      reason: 'no App Router or Pages Router directory to scaffold a component into',
    };
  }

  const useTypeScript = existsSync(join(cwd, 'tsconfig.json'));
  const ext = useTypeScript ? 'tsx' : 'jsx';
  const filePath = join(target.dir, `${JSON_LD_COMPONENT_BASE}.${ext}`);
  const wiring: JsonLdWiring = {
    importLine: `import { ${COMPONENT_NAME} } from './${JSON_LD_COMPONENT_BASE}';`,
    element: `<${COMPONENT_NAME} />`,
    layoutPath: relative(cwd, join(target.dir, `${target.wiringFileBase}.${ext}`)),
  };

  if (existsSync(filePath)) return { action: 'exists', path: filePath, wiring };

  try {
    mkdirSync(target.dir, { recursive: true });
    writeFileSync(filePath, componentSource(options), 'utf8');
  } catch (err) {
    options.warn(
      `Tried to scaffold an Organization JSON-LD component at ${filePath} but couldn't ` +
        `(${(err as Error).message}).`,
    );
    return { action: 'skipped', reason: 'the component file could not be written' };
  }

  return { action: 'created', path: filePath, wiring };
}

/**
 * The generated component: a server component rendering one `<script type="application/ld+json">`.
 *
 * Values from `package.json` are embedded via `JSON.stringify`, the same escaping guarantee
 * write.ts relies on for its route handlers — a stringified string is a valid, fully escaped
 * JavaScript string literal, so a quote, backslash, or newline in a description can't break the
 * generated source. The block itself is then serialized with `JSON.stringify` at render time
 * (rather than pasted as text) so the same escaping protects the emitted HTML.
 */
function componentSource(options: ScaffoldJsonLdOptions): string {
  const { site, siteUrl } = options;

  const fields = [`  '@context': 'https://schema.org',`, `  '@type': 'Organization',`];
  fields.push(`  name: ${JSON.stringify(site.displayName)},`);
  if (site.description !== undefined) {
    fields.push(`  description: ${JSON.stringify(site.description)},`);
  }
  fields.push(
    siteUrl !== undefined
      ? `  url: ${JSON.stringify(siteUrl)},`
      : `  // TODO: your site's absolute production URL. ax couldn't resolve one at build time —\n` +
          `  // set siteUrl in ax.config (or a SITE_URL env var) and it will be filled in for you\n` +
          `  // on the next scaffold.\n` +
          `  url: '',`,
  );
  fields.push(
    `  // TODO: list the external profiles that identify this organization — LinkedIn, GitHub, npm,`,
    `  // Crunchbase, X, Wikipedia. This is the entity-disambiguation signal registries actually`,
    `  // rank on, and it can't be derived from your repo, so an empty array here earns nothing.`,
    `  sameAs: [],`,
  );

  return `// Organization structured data, scaffolded by ax (scaffoldJsonLd). This file is yours: edit
// it freely, ax never overwrites it.
//
// Nothing renders it until you add it to your root layout — one import and one element:
//   ${`import { ${COMPONENT_NAME} } from './${JSON_LD_COMPONENT_BASE}';`}
//   ...then render <${COMPONENT_NAME} /> inside <body>.
//
// Worth adding beyond the fields below: a logo, an address, and at least one more schema.org
// @type for what you actually offer (SoftwareApplication / Product for an app or API, FAQPage for
// a support site) — covering more types helps registries understand the site more fully.
const organization = {
${fields.join('\n')}
};

export function ${COMPONENT_NAME}() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
    />
  );
}
`;
}
