import Head from 'next/head';
import Link from 'next/link';

export default function CheckoutPage() {
  return (
    <main>
      <Head>
        <title>Checkout — Ora Air</title>
        <meta name="description" content="Pay for your pending booking with the demo test card." />
      </Head>
      <h1>Checkout</h1>
      <p>
        Pay with the test card 4242 4242 4242 4242 — any other number declines. A successful payment
        lands on the <Link href="/confirmation">confirmation</Link> page.
      </p>
    </main>
  );
}
