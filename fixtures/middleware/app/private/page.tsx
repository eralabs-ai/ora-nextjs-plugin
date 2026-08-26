// Gated by the fixture's isGated matcher. The manifest records /private in gatedPaths, so the
// middleware must fall through untouched for agents too — the app's own auth answer is the honest
// one, and a twin never gets generated for a gated route in the first place.
export default function Private() {
  return (
    <main>
      <h1>Sign in</h1>
      <p>
        You need to sign in to see this page. This stand-in login shell carries enough text to pass
        the twin pass&apos;s length guard, proving its skip comes from the gating policy alone.
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
