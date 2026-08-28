import type { GetStaticPaths, GetStaticProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { AIRPORTS, getAirport, type Airport } from '@/lib/data/airports';

// Dynamic segment under a static parent — the Pages Router shape of the same scenario the
// flagship covers with app/destinations/[slug]: the manifest records the /destinations prefix
// and the middleware never claims "not found" beneath it.
export const getStaticPaths: GetStaticPaths = () => ({
  paths: AIRPORTS.map((airport) => ({ params: { slug: airport.code.toLowerCase() } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<{ airport: Airport }> = ({ params }) => {
  const airport = getAirport(String(params?.slug ?? ''));
  if (!airport) return { notFound: true };
  return { props: { airport } };
};

export default function DestinationPage({ airport }: { airport: Airport }) {
  return (
    <main>
      <Head>
        <title>{`${airport.city} (${airport.code}) — Ora Air destinations`}</title>
      </Head>
      <h1>
        {airport.city} ({airport.code})
      </h1>
      <p>
        Ora Air serves {airport.city} through {airport.name}, {airport.country}. Browse the{' '}
        <Link href="/destinations">full route network</Link> or <Link href="/">search fares</Link>.
      </p>
    </main>
  );
}
