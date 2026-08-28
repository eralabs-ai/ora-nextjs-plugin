import type { Metadata } from 'next';
import Link from 'next/link';
import { AIRPORTS } from '@/lib/data/airports';

// A pure server component rendered from the route-network data — the "real content" page shape:
// no client JS, statically prerendered, so its markdown twin mirrors the actual content.
export const metadata: Metadata = {
  title: 'Destinations & route network — Ora Air',
  description:
    'All 12 Ora Air destinations across the United States, Europe, the Middle East, and Asia — ' +
    'airports, cities, and countries we fly to with one-way fares.',
};

export default function DestinationsPage() {
  const byCountry = new Map<string, typeof AIRPORTS>();
  for (const airport of AIRPORTS) {
    byCountry.set(airport.country, [...(byCountry.get(airport.country) ?? []), airport]);
  }

  return (
    <div>
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-1 text-[13px] font-medium tracking-[0.2em] text-gold uppercase">
          Route network
        </div>
        <h1 className="text-3xl font-semibold text-ink">Where we fly</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-mist">
          Ora Air serves {AIRPORTS.length} airports across {byCountry.size} countries. Every route
          is bookable one-way — pick any two airports below and{' '}
          <Link href="/" className="text-navy underline">
            search fares
          </Link>
          .
        </p>

        {[...byCountry.entries()].map(([country, airports]) => (
          <section key={country} className="mt-10">
            <h2 className="text-xl font-semibold text-ink">{country}</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {airports.map((airport) => (
                <div key={airport.code} className="rounded-2xl border border-line bg-white p-5">
                  <div className="text-[12px] tracking-[0.16em] text-mist uppercase">
                    {airport.code}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-ink">{airport.city}</div>
                  <div className="mt-1 text-[13px] text-mist">{airport.name}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
