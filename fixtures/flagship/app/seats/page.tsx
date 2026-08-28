import type { Metadata } from 'next';
import SeatsClient from './seats-client';

// Thin server wrapper: the flow step itself is a client component (booking context, interactivity),
// but the route's metadata must live in a server module — and it is what the markdown twin and
// social/search snippets are derived from.
export const metadata: Metadata = {
  title: 'Choose your seat — Ora Air',
  description:
    'Pick your seat from the live cabin map — Economy, Premium, and Business with per-seat fees shown upfront.',
};

export default function Page() {
  return <SeatsClient />;
}
