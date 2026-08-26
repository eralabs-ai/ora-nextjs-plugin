// This route's markdown twin is the hand-written public/hand.md (no generated-by marker): ax must
// record it as user-owned and never overwrite it, even though the prerendered HTML here would
// otherwise clear every Tier-2 guard.
export default function Hand() {
  return (
    <main>
      <h1>Hand-authored twin</h1>
      <p>
        The markdown for this page is maintained by a human in public/hand.md. If ax ever replaces
        that file with a generated conversion of this HTML, the user-owned guard has regressed. The
        paragraph carries enough text to clear the length guard, so nothing but the marker check can
        be what protects the file.
      </p>
    </main>
  );
}
