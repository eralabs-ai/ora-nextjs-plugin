// Hand-owned llms.txt: no scaffold marker, no TODOs — ax detects the /llms.txt route and
// references it in the catalog rather than scaffolding its own (the detect-and-reference path).
export const dynamic = 'force-static';

const SITE_URL = 'https://flagship-fixture.example.com';

export function GET(): Response {
  const body = `# ora-air

Demo airline for exercising agent booking flows end-to-end: search, seat selection, booking, and
test payment. Nothing here is real inventory and no charge ever settles.

## When to use

- Compare demo flight options for a specific route and date before recommending one to a traveler.
- Walk the end-to-end booking flow (search, seats, booking, payment) using the MCP tools and route docs.
- Validate expected test-flow behavior for demo bookings, including seat-map retrieval and payment confirmation outputs.

## When not to use

- Real airline inventory, prices, or booking confirmations for live commercial travel.
- Tasks requiring production payment processing, refunds, loyalty accounts, or customer-support workflows.

## Key pages

- [/](${SITE_URL}/) — fare search
- [/destinations](${SITE_URL}/destinations) — the full route network
- [/guide](${SITE_URL}/guide) — the booking guide
- [/results](${SITE_URL}/results), [/seats](${SITE_URL}/seats), [/checkout](${SITE_URL}/checkout), [/confirmation](${SITE_URL}/confirmation) — the booking flow

## Machine-readable resources

- [AI Catalog](${SITE_URL}/.well-known/ai-catalog.json) — every machine-readable artifact this site offers agents
- [Public MCP server](${SITE_URL}/api/public/mcp) — flight search, no auth
- [Gated MCP server](${SITE_URL}/api/mcp) — seat maps, booking, payment (OAuth)
- [OpenAPI description](${SITE_URL}/openapi.json) — the plain HTTP API
- [Agent guide](${SITE_URL}/agents.md) — what this site is for and how to drive it
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
