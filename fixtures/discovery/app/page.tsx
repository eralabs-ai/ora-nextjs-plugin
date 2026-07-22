export default function Home() {
  return (
    <main>
      <h1>Discovery fixture</h1>
      <p>
        This app already ships a robots.txt, an app/sitemap.ts, and a public/agents.md. The plugin
        should detect all three and emit &ldquo;detected&rdquo; recommendations for them — never
        catalog entries, and never a build failure.
      </p>
    </main>
  );
}
