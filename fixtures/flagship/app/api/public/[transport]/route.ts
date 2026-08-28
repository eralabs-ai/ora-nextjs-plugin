import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

import { searchFlights } from '@/lib/services/search';

// Public MCP server — unauthenticated, advertised as an open surface. Booking tools live
// on the gated server at /api/gated/mcp so ax can gate that surface without hiding search.
const handler = createMcpHandler(
  (server) => {
    server.tool(
      'search_flights',
      'Search available flights between two cities on a date. To book, use the gated MCP server at /api/gated/mcp.',
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
  {
    serverInfo: { name: 'ora-air-search', version: '0.1.0' },
  },
  {
    basePath: '/api/public',
    maxDuration: 60,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
