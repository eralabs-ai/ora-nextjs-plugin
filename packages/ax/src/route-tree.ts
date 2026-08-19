// The `next build`-style route tree ax prints wherever a gating decision is being made — the
// layout developers already read after every build, except MCP servers are broken into their tools
// as leaves, since those are the callable surfaces the gating decision is about. The tree exists
// to serve that decision: it renders only when at least one MCP mount was detected (`ax init`'s
// findings, and the build's review gate when an unreviewed mount appears).

import type { RouterKind } from './router-model.js';
import { servedPath } from './site-url.js';

export interface RouteTreeMount {
  pathname: string;
  tools: string[];
  /** Whether a `withMcpAuth` wrapper was detected, for the "auth detected" annotation. */
  authDetected?: boolean;
}

export interface RouteTreeInput {
  routers: RouterKind[];
  /** Statically addressable page routes (`RouterModel.listPageRoutes()`). */
  pageRoutes: string[];
  /** API routes that resolved to a stable URL, MCP mounts included. */
  apiRoutePaths: string[];
  /** `next.config` `basePath` (`''` when unset) — every rendered path is the served one. */
  basePath: string;
  mounts: RouteTreeMount[];
}

/** One row of the tree: a served path, its kind marker, and any MCP tool leaves. */
interface RouteTreeNode {
  path: string;
  marker: '○' | 'ƒ';
  note?: string;
  children: string[];
}

/**
 * Distills the input into sorted route rows: page routes (○), API route handlers (ƒ), and MCP
 * mounts (ƒ, with their tools as leaves). Every path is the *served* (basePath-prefixed) one, so
 * what the tree shows is exactly the path a gating decision applies to.
 */
function buildRouteTree(input: RouteTreeInput): RouteTreeNode[] {
  const served = (pathname: string): string => servedPath(input.basePath, pathname);
  const mcpPaths = new Set(input.mounts.map((mount) => mount.pathname));
  const nodes = new Map<string, RouteTreeNode>();
  for (const route of input.pageRoutes) {
    nodes.set(served(route), { path: served(route), marker: '○', children: [] });
  }
  for (const route of input.apiRoutePaths) {
    if (mcpPaths.has(route)) continue;
    nodes.set(served(route), { path: served(route), marker: 'ƒ', children: [] });
  }
  for (const mount of input.mounts) {
    nodes.set(served(mount.pathname), {
      path: served(mount.pathname),
      marker: 'ƒ',
      note: `MCP server${mount.authDetected === true ? ' · auth detected' : ''}`,
      children: mount.tools,
    });
  }
  return [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * One rendered tree line. An MCP server node line carries its mount's pathname, so a caller can
 * turn exactly those lines into selectable choices (the gating question puts its checkbox *on* the
 * server node, inside the tree) while every other line stays display-only.
 */
export interface RouteTreeLine {
  text: string;
  mountPathname?: string;
}

/**
 * Renders the tree as tagged lines (no `[ax] ` prefix), with a legend for the markers used.
 * Returns an empty array when there are no routes at all.
 */
export function buildRouteTreeLines(input: RouteTreeInput): RouteTreeLine[] {
  const nodes = buildRouteTree(input);
  if (nodes.length === 0) return [];
  const mountByServedPath = new Map(
    input.mounts.map((mount) => [servedPath(input.basePath, mount.pathname), mount.pathname]),
  );
  const width = Math.max(...nodes.map((node) => node.path.length));
  const lines: RouteTreeLine[] = [
    { text: `Route (${input.routers.length > 0 ? input.routers.join(' + ') : 'none'})` },
  ];
  nodes.forEach((node, index) => {
    const connector = index === 0 && nodes.length > 1 ? '┌' : index < nodes.length - 1 ? '├' : '└';
    const padded = node.note !== undefined ? node.path.padEnd(width + 2) : node.path;
    const mountPathname = mountByServedPath.get(node.path);
    lines.push({
      text: `${connector} ${node.marker} ${padded}${node.note ?? ''}`.trimEnd(),
      ...(mountPathname !== undefined ? { mountPathname } : {}),
    });
    const stem = index < nodes.length - 1 ? '│' : ' ';
    node.children.forEach((tool, toolIndex) => {
      const toolConnector = toolIndex < node.children.length - 1 ? '├' : '└';
      lines.push({ text: `${stem}   ${toolConnector} ⚙ ${tool}` });
    });
  });
  const legend = ['○ page', 'ƒ api route'];
  if (nodes.some((node) => node.children.length > 0)) legend.push('⚙ MCP tool');
  lines.push({ text: '' }, { text: legend.join('   ') });
  return lines;
}

/** The tree as plain display lines — for contexts with nothing to select. */
export function renderRouteTree(input: RouteTreeInput): string[] {
  return buildRouteTreeLines(input).map((line) => line.text);
}
