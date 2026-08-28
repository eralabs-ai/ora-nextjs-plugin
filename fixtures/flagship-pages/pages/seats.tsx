import Head from 'next/head';
import Link from 'next/link';

export default function SeatsPage() {
  return (
    <main>
      <Head>
        <title>Choose your seat — Ora Air</title>
        <meta name="description" content="Pick a seat from the cabin map before payment." />
      </Head>
      <h1>Choose your seat</h1>
      <p>
        Every fare class permits seat selection before payment. Continue to{' '}
        <Link href="/checkout">checkout</Link> once you have picked one.
      </p>
    </main>
  );
}
