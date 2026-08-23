// A JS-shell page with no page-owned metadata: the twin pass refuses it (too little text), so this
// route is permanently twin-less — the stable dogfood case for "real route, no twin: agents get
// the HTML, because inventing a markdown representation would be a lie".
export default function Shell() {
  return (
    <main>
      <div id="app" />
    </main>
  );
}
