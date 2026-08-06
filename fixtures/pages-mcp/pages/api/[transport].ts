import { createMcpHandler } from 'mcp-handler';
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

// An MCP server mounted the Pages Router way: a catch-all API route at `pages/api/[transport].ts`,
// served at /api/mcp (mcp-handler's documented `[transport]` default). The plugin detects it
// textually — the `mcp-handler` import plus the `createMcpHandler(` call — exactly as it does for
// an App Router `route.ts` mount.
const mcpHandler = createMcpHandler((server) => {
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

// mcp-handler produces a Web-standard `(Request) => Promise<Response>`; bridge it to the Pages
// Router's `(req, res)` API-route signature.
export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const url = `https://${req.headers.host ?? 'localhost'}${req.url ?? '/api/mcp'}`;
  const response = await mcpHandler(new Request(url, { method: req.method }));
  res.status(response.status);
  res.send(await response.text());
}
