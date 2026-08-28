import Head from 'next/head';
import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <Head>
        <title>Ora Air — book demo flights</title>
        <meta
          name="description"
          content="Demo airline for exercising agent booking flows: search fares, pick seats, and pay with a test card."
        />
      </Head>
      <h1>Fly Ora Air</h1>
      <p>
        Search one-way fares across our route network, hold a seat, and pay with the test card.
        Nothing here is real inventory and no charge ever settles.
      </p>
      <p>
        Start with the <Link href="/destinations">route network</Link> or jump straight to{' '}
        <Link href="/results">results</Link>.
      </p>
    </main>
  );
}
