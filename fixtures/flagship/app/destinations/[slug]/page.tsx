import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AIRPORTS, getAirport } from '@/lib/data/airports';

// Dynamic segment under a static parent: the manifest records the /destinations prefix as
// dynamic, twins are never guessed for it, and the middleware never claims "not found" beneath
// it (any slug renders here or 404s honestly via notFound()).
export function generateStaticParams() {
  return AIRPORTS.map((airport) => ({ slug: airport.code.toLowerCase() }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const airport = getAirport(slug);
  if (!airport) return { title: 'Destination not found — Ora Air' };
  return {
    title: `${airport.city} (${airport.code}) — Ora Air destinations`,
    description: `Fly Ora Air to ${airport.city} via ${airport.name} (${airport.code}), ${airport.country}.`,
  };
}

export default async function DestinationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const airport = getAirport(slug);
  if (!airport) notFound();

  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <div className="mb-1 text-[13px] font-medium tracking-[0.2em] text-gold uppercase">
        Destination
      </div>
      <h1 className="text-3xl font-semibold text-ink">
        {airport.city} ({airport.code})
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-mist">
        Ora Air serves {airport.city} through {airport.name}, {airport.country}. Every route is
        bookable one-way —{' '}
        <Link href="/" className="text-navy underline">
          search fares
        </Link>{' '}
        from any of our other {AIRPORTS.length - 1} airports, or browse the{' '}
        <Link href="/destinations" className="text-navy underline">
          full route network
        </Link>
        .
      </p>
    </div>
  );
}
