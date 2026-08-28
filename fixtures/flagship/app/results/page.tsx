import type { Metadata } from 'next';
import ResultsClient from './results-client';

// Thin server wrapper: the flow step itself is a client component (booking context, interactivity),
// but the route's metadata must live in a server module — and it is what the markdown twin and
// social/search snippets are derived from.
export const metadata: Metadata = {
  title: 'Flight results — Ora Air',
  description: 'Compare one-way Ora Air fares and cabins for your route and date.',
};

export default function Page() {
  return <ResultsClient />;
}
