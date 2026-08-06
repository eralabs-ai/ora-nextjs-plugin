// A dynamic route: its concrete URL isn't statically knowable, so the plugin must NOT list it
// (precision over recall — never guess a dynamic URL).
export default function BlogPost() {
  return <article>A blog post.</article>;
}
