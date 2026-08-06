export default function Home() {
  return (
    <main>
      <h1>WebMCP declarative fixture (Pages Router)</h1>
      {/* Declarative WebMCP: the tool is described by the form's `toolname` attribute, read straight
          off the JSX. The page URL (`/`) is resolved from the Pages Router file path. */}
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
