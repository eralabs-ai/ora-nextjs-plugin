import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';

// The gated MCP server: wrapped in `withMcpAuth`, so ax detects the auth requirement statically,
// marks the surface gated (auth.status "unknown"), and cross-links the RFC 9728 metadata from the
// `resourceMetadataPath` literal into this server's card. Its card lands at the named per-server
// slot, never the root path a blind registry probe would hit first.
const handler = createMcpHandler((server) => {
  server.tool(
    'place_order',
    'Place an order for the signed-in customer.',
    { item: z.string().describe('Menu item id') },
    async ({ item }) => ({ content: [{ type: 'text', text: `🧾 ordered ${item}` }] }),
  );
});

// A no-op verifier stands in for a real token check — enough to exercise the gated code path.
const verifyToken = async (_req: Request): Promise<undefined> => undefined;

const authed = withMcpAuth(handler, verifyToken, {
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
});

export { authed as GET, authed as POST, authed as DELETE };
