import type { Metadata } from 'next';
import ConfirmationClient from './confirmation-client';

// Thin server wrapper: the flow step itself is a client component (booking context, interactivity),
// but the route's metadata must live in a server module — and it is what the markdown twin and
// social/search snippets are derived from.
export const metadata: Metadata = {
  title: 'Booking confirmed — Ora Air',
  description: 'Your Ora Air booking reference (PNR), itinerary summary, and receipt.',
};

export default function Page() {
  return <ConfirmationClient />;
}
