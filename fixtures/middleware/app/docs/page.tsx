// The negotiation target: its markdown twin is the committed, hand-authored public/docs.md (no
// generated-by marker), so the prebuild manifest lists the twin on the very first build and the
// dual-fetch dogfood can prove the rewrite without a second build.
export default function Docs() {
  return (
    <main>
      <h1>Docs</h1>
      <p>
        Browsers and search crawlers see this HTML. Detected agents — and any client sending Accept:
        text/markdown — are rewritten by the middleware to the markdown twin at /docs.md, with Vary:
        Accept and a canonical Link pointing back at this page.
      </p>
    </main>
  );
}
