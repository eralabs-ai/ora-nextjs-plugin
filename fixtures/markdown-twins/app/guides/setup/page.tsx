export const metadata = {
  title: 'Setup guide',
  description: 'How to set up the markdown-twins fixture.',
};

export default function SetupGuide() {
  return (
    <main>
      <h1>Setup guide</h1>
      <p>
        A nested prerendered route, so the twin lands at a nested public path
        (public/guides/setup.md) and its canonical URL carries the full route. The paragraph is long
        enough to clear the two-hundred-character shell guard by a comfortable margin, because a
        twin of a page with no real text would be an empty page presented as content.
      </p>
      <h2>Steps</h2>
      <ol>
        <li>Install dependencies.</li>
        <li>Run the build.</li>
        <li>Read the generated report.</li>
      </ol>
    </main>
  );
}
