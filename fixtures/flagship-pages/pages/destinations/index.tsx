import Head from 'next/head';
import Link from 'next/link';
import { AIRPORTS } from '@/lib/data/airports';

// The route-network page, with the declarative WebMCP form: the tool is described by the form's
// `toolname` attribute, read straight off the JSX, and the page URL (`/destinations`) is resolved
// from the Pages Router file path.
export default function DestinationsPage() {
  return (
    <main>
      <Head>
        <title>Destinations &amp; route network — Ora Air</title>
        <meta
          name="description"
          content="All 12 Ora Air destinations — airports, cities, and countries we fly to."
        />
      </Head>
      <h1>Where we fly</h1>
      <p>Ora Air serves {AIRPORTS.length} airports. Every route is bookable one-way.</p>
      <ul>
        {AIRPORTS.map((airport) => (
          <li key={airport.code}>
            <Link href={`/destinations/${airport.code.toLowerCase()}`}>
              {airport.code} — {airport.city}, {airport.name} ({airport.country})
            </Link>
          </li>
        ))}
      </ul>
      <form
        toolname="watch_route"
        tooldescription="Get an email alert when fares drop on a route."
        action="/api/watch"
        method="post"
      >
        <label>
          Origin
          <input name="origin" required />
        </label>
        <label>
          Destination
          <input name="destination" required />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <button type="submit">Watch this route</button>
      </form>
    </main>
  );
}
