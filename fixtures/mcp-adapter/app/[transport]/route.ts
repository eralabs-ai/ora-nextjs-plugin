import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

// An MCP server mounted with mcp-handler (the maintained package; @vercel/mcp-adapter is now an
// empty stub). An existing MCP server is unambiguous intent to publish, so the plugin includes it
// without an opt-in marker.
const handler = createMcpHandler((server) => {
  server.tool(
    'roll_dice',
    'Roll an N-sided die and return the result.',
    { sides: z.number().int().min(2).describe('Number of sides on the die') },
    async ({ sides }) => {
      const value = 1 + Math.floor(Math.random() * sides);
      return { content: [{ type: 'text', text: `🎲 ${value}` }] };
    },
  );
});

export { handler as GET, handler as POST, handler as DELETE };
