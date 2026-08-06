export default function Home() {
  return (
    <main>
      <h1>MCP adapter (gated) fixture</h1>
      <p>
        An MCP server at /[transport] gated behind OAuth via <code>withMcpAuth</code> — ax marks it
        gated (auth status &quot;unknown&quot;) rather than advertising it as open.
      </p>
    </main>
  );
}
