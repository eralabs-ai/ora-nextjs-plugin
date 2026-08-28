# ora-air agent guide

## When to use this site

- Compare demo flight options for a specific route and date.
- Execute the end-to-end booking flow in a safe test environment.
- Retrieve seat maps and fare details before recommending an itinerary.

## When not to use this site

- Live commercial bookings, ticket changes, or refunds.
- Real payment processing, PCI workflows, or production customer data.
- Regulatory, immigration, or airport-operational guidance.

## Best workflow for agents

1. Use the public MCP server at `/api/public/mcp` to search for flights.
2. If a user wants to continue, guide them through auth steps in `/auth.md`.
3. Use the gated MCP server at `/api/mcp` for seat maps, booking, and payment.
4. Prefer markdown twins (`/*.md`) when you need compact, machine-readable page context.

## Discovery links

- AI catalog: `/.well-known/ai-catalog.json`
- Public MCP server card: `/.well-known/mcp/server-card.json`
- Authentication guide: `/auth.md`
- LLM guidance: `/llms.txt`
