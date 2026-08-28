import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Detects which auth provider the app depends on — package.json only, no code scanning — so the
// build report's auth section can say what the site already owns and what that's worth for
// agents. Deliberately *no wiring snippets*: provider APIs drift, so each note states the durable
// fact (whether this provider can act as an OAuth authorization server for agent surfaces) and
// points at the provider's own documentation by name, which stays correct across their releases.

export interface DetectedAuthProvider {
  /** Stable short name, e.g. `clerk`. */
  name: string;
  /** The dependency that identified it, e.g. `@clerk/nextjs`. */
  package: string;
  /** What this provider means for agent auth — a durable fact, never version-specific wiring. */
  note: string;
}

/** Known providers, most specific first — the first dependency hit wins. */
const PROVIDERS: DetectedAuthProvider[] = [
  {
    name: 'clerk',
    package: '@clerk/nextjs',
    note:
      'Clerk can act as the OAuth 2.0 authorization server for a gated MCP server, so agents ' +
      'authenticate via standard OAuth discovery instead of a hand-configured key — see Clerk’s ' +
      'MCP documentation for the current wiring.',
  },
  {
    name: 'better-auth',
    package: 'better-auth',
    note:
      'Better Auth’s MCP plugin can serve OAuth 2.0 for a gated MCP server, so agents ' +
      'authenticate via standard OAuth discovery — see the Better Auth MCP plugin documentation.',
  },
  {
    name: 'auth0',
    package: '@auth0/nextjs-auth0',
    note:
      'Auth0 is a full OAuth 2.0 authorization server; a gated agent surface can point agents at ' +
      'it via RFC 9728 protected-resource metadata — see Auth0’s documentation on securing ' +
      'APIs and MCP servers.',
  },
  {
    name: 'next-auth',
    package: 'next-auth',
    note:
      'next-auth signs humans in but does not expose an OAuth authorization server agents can ' +
      'use. The practical agent lane is an API key issued behind your existing login, declared ' +
      'via entries[].auth (status "api_key" + docsUrl) so agents learn where a human obtains it.',
  },
  {
    name: 'next-auth',
    package: '@auth/core',
    note:
      'Auth.js signs humans in but does not expose an OAuth authorization server agents can use. ' +
      'The practical agent lane is an API key issued behind your existing login, declared via ' +
      'entries[].auth (status "api_key" + docsUrl) so agents learn where a human obtains it.',
  },
];

/**
 * The first known auth-provider dependency in package.json (dependencies then devDependencies),
 * or undefined for none/unreadable — this never fails a build.
 */
export function detectAuthProvider(cwd: string): DetectedAuthProvider | undefined {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return undefined;
  let deps: Record<string, unknown>;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    deps = { ...pkg.devDependencies, ...pkg.dependencies };
  } catch {
    return undefined;
  }
  return PROVIDERS.find((provider) => provider.package in deps);
}
