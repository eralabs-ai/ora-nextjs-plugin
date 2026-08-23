import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

// The public MCP server: mounted with mcp-handler and no auth wrapper. On a fresh checkout no
// gating decision is on record for it, so a headless build advertises it as open (the zero-config
// default) and lists it in the report's unreviewedMounts; it is also the default primary — the
// server whose card owns the root well-known path — precisely because it is the public one.
const handler = createMcpHandler((server) => {
  server.tool(
    'search_menu',
    'Search the menu and return matching items.',
    { query: z.string().describe('Free-text search query') },
    async ({ query }) => ({ content: [{ type: 'text', text: `🔎 results for ${query}` }] }),
  );
});

export { handler as GET, handler as POST, handler as DELETE };
