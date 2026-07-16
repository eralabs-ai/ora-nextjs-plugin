export default function Home() {
  return (
    <main>
      <h1>WebMCP declarative fixture</h1>
      {/* Declarative WebMCP: the tool is described by the form's `toolname` attribute. The Phase 4
          declarative detector reads this straight off the JSX — high-confidence, near-trivial. */}
      <form
        toolname="subscribe_newsletter"
        tooldescription="Subscribe an email address to the newsletter."
        action="/api/subscribe"
        method="post"
      >
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <button type="submit">Subscribe</button>
      </form>
    </main>
  );
}
