import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';

// An MCP server mounted with mcp-handler, then gated behind OAuth with `withMcpAuth` — Clerk's
// official MCP path, and the ecosystem-idiomatic way to require auth. ax detects the wrapper
// statically and marks the surface gated (auth.status "unknown"; the OAuth endpoints aren't
// derivable at build time), and reads the `resourceMetadataPath` literal to cross-link the RFC 9728
// metadata in the server card. It never advertises this server as open.
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

// A no-op verifier stands in for a real token check — enough to exercise the gated code path.
const verifyToken = async (_req: Request): Promise<undefined> => undefined;

const authed = withMcpAuth(handler, verifyToken, {
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
});

export { authed as GET, authed as POST, authed as DELETE };
