export default function Home() {
  return (
    <main>
      <h1>Markdown twins fixture</h1>
      <p>
        This page exists so the build output contains a prerendered route with a real content
        region. The twin derived from it should carry this prose, the heading above, the list and
        the code block below — and none of the navigation or footer chrome the layout wraps around
        every page.
      </p>
      <ul>
        <li>
          Read the <a href="/guides/setup">setup guide</a> for the nested-route case.
        </li>
        <li>The shell, private, and blog routes each exercise a refusal.</li>
      </ul>
      <pre>
        <code>npx ax --report</code>
      </pre>
    </main>
  );
}
