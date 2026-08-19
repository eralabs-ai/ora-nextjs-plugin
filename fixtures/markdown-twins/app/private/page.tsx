// Gated by the fixture's isGated matcher: statically this prerenders like any page (here it even
// renders a login shell, the typical gated-page prerender), so the twin pass must refuse it on the
// gating signal alone — a beautifully converted login page is the exact lie the gate exists for.
export default function Private() {
  return (
    <main>
      <h1>Sign in</h1>
      <p>
        You need to sign in to see this page. This stand-in login shell carries enough text to pass
        the length guard, proving the skip comes from the gating policy and not from a short page.
      </p>
      <form>
        <label>
          Email <input type="email" name="email" />
        </label>
        <button type="submit">Continue</button>
      </form>
    </main>
  );
}
