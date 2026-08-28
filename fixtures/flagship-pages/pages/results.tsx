import Head from 'next/head';
import Link from 'next/link';

export default function ResultsPage() {
  return (
    <main>
      <Head>
        <title>Flight results — Ora Air</title>
        <meta name="description" content="Compare fares and pick a flight for your route." />
      </Head>
      <h1>Flight results</h1>
      <p>
        Fares are generated per route and date in this demo. Pick a flight, then choose a{' '}
        <Link href="/seats">seat</Link>.
      </p>
    </main>
  );
}
