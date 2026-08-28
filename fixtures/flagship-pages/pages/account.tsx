import Head from 'next/head';

// Gated page route: listed in ax.config's isGated matcher, so it lands in the serving manifest's
// gatedPaths and the middleware falls through untouched for agents too.
export default function AccountPage() {
  return (
    <main>
      <Head>
        <title>My bookings — Ora Air</title>
        <meta name="description" content="Sign in to view and manage your Ora Air bookings." />
      </Head>
      <h1>Sign in to view your bookings</h1>
      <p>
        Your bookings, receipts, and saved travelers live behind sign-in. Use the email address from
        your confirmation to receive a one-time sign-in link.
      </p>
    </main>
  );
}
