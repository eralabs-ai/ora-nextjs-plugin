// A JS-shell page: the prerendered HTML has a <main> but almost no text, so the twin pass must
// skip it with the too-little-text reason instead of publishing an empty twin.
export default function Shell() {
  return (
    <main>
      <div id="app" />
    </main>
  );
}
