export default function Home() {
  return (
    <main>
      <h1>MCP multi-server fixture</h1>
      <p>
        Two MCP servers: a public one at /api/public/mcp and one gated behind OAuth via{' '}
        <code>withMcpAuth</code> at /api/mcp. ax emits one server card per server — the primary
        (public) card at the root well-known path, and each server&apos;s card at its named slot.
      </p>
    </main>
  );
}
