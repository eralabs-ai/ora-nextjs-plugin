export default function Home() {
  return (
    <main>
      <h1>Middleware fixture</h1>
      <p>
        This prerendered homepage gets a generated markdown twin on the postbuild run. On a fresh
        checkout the prebuild manifest does not list that twin yet (it is generated after this
        build), so the middleware serves this HTML to everyone until the next build — the documented
        one-build staleness, and the reason the dogfood probes target the hand-authored docs twin
        instead.
      </p>
      <p>
        Enough prose lives here to clear the twin pass&apos;s minimum-content guard, so the homepage
        twin lands in this fixture&apos;s golden snapshots.
      </p>
    </main>
  );
}
