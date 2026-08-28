import { createMcpHandler } from 'mcp-handler';
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { searchFlights } from '@/lib/services/search';

// The flagship's public MCP server mounted the Pages Router way — unauthenticated, advertised as
// an open surface, served at /api/public/mcp.
const mcpHandler = createMcpHandler(
  (server) => {
    server.tool(
      'search_flights',
      'Search available flights between two cities on a date. To book, use the gated MCP server at /api/mcp.',
      {
        origin: z.string().describe("Origin city or airport, e.g. 'New York' or 'JFK'"),
        destination: z
          .string()
          .describe("Destination city or airport, e.g. 'Los Angeles' or 'LAX'"),
        date: z.string().describe('Departure date, ISO 8601 (YYYY-MM-DD)'),
        passengers: z.number().int().min(1).max(9).default(1).describe('Number of passengers'),
      },
      async ({ origin, destination, date, passengers }) => {
        const flights = searchFlights({ origin, destination, date, passengers });
        if (!flights) {
          return {
            content: [{ type: 'text', text: 'No flights found for that route/date.' }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(flights) }] };
      },
    );
  },
  { serverInfo: { name: 'ora-air-search', version: '0.1.0' } },
  { basePath: '/api/public', maxDuration: 60 },
);

// mcp-handler produces a Web-standard `(Request) => Promise<Response>`; bridge it to the Pages
// Router's `(req, res)` API-route signature.
export const config = { api: { bodyParser: false } };

export default async function apiHandler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const url = `https://${req.headers.host ?? 'localhost'}${req.url ?? '/api/public/mcp'}`;
  const response = await mcpHandler(new Request(url, { method: req.method }));
  res.status(response.status);
  res.send(await response.text());
}
