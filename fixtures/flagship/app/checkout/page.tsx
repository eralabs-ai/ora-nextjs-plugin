import type { Metadata } from 'next';
import CheckoutClient from './checkout-client';

// Thin server wrapper: the flow step itself is a client component (booking context, interactivity),
// but the route's metadata must live in a server module — and it is what the markdown twin and
// social/search snippets are derived from.
export const metadata: Metadata = {
  title: 'Checkout — Ora Air',
  description:
    'Passenger details and payment for your Ora Air booking. Demo payments only — use test card 4242 4242 4242 4242.',
};

export default function Page() {
  return <CheckoutClient />;
}
