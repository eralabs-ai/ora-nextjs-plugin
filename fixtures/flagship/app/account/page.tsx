import type { Metadata } from 'next';

// Gated page route: listed in ax.config's isGated matcher, so it lands in the serving manifest's
// gatedPaths and the middleware falls through untouched for agents too — the app's auth answer
// stays the honest one. The page itself is a plain sign-in wall; no real auth flow exists here.
export const metadata: Metadata = {
  title: 'My bookings — Ora Air',
  description: 'Sign in to view and manage your Ora Air bookings.',
};

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-ink">Sign in to view your bookings</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-mist">
        Your bookings, receipts, and saved travelers live behind sign-in. Use the email address from
        your confirmation to receive a one-time sign-in link.
      </p>
    </div>
  );
}
