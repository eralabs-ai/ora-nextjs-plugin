import Head from 'next/head';
import Link from 'next/link';

export default function ConfirmationPage() {
  return (
    <main>
      <Head>
        <title>Booking confirmed — Ora Air</title>
        <meta name="description" content="Your demo booking is confirmed, with a PNR to keep." />
      </Head>
      <h1>Booking confirmed</h1>
      <p>
        Your PNR and receipt live in <Link href="/account">your bookings</Link>. This is a demo: no
        ticket was issued and no charge settled.
      </p>
    </main>
  );
}
