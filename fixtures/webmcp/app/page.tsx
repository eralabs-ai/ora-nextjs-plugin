import { RegisterTools } from './register-tools';

export default function Home() {
  return (
    <main>
      <h1>WebMCP fixture</h1>
      {/* Visible prose naming the API — must never be detected as a registration. */}
      <p>Registers an in-page tool via navigator.modelContext.registerTool().</p>
      {/* Declarative WebMCP: the tool is described by the form's `toolname` attribute, read
          straight off the JSX — high-confidence, and the only WebMCP shape that yields a catalog
          entry (the page URL is the tool surface). */}
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
      {/* Imperative WebMCP on the same page: detected as a tool name, but never invented into an
          entry — a registerTool() call is invisible in server-rendered HTML. */}
      <RegisterTools />
    </main>
  );
}
