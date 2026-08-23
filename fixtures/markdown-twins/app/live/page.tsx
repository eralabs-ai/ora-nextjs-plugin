// The metadata-rung case: a client-rendered page structured the recommended way — page.tsx stays
// a server component that declares the page's own metadata and renders the client part, so the
// prerender has a real head but an empty <main> (and no flickering placeholder DOM). The twin is
// derived from the metadata alone and says so.
import { LiveBoard } from './live-board';

export const metadata = {
  title: 'Live departures board',
  description: 'Real-time departures, fetched in the browser after the page loads.',
};

export default function LivePage() {
  return (
    <main>
      <LiveBoard />
    </main>
  );
}
