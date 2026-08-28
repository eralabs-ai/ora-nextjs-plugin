import type { Metadata } from 'next';
import Link from 'next/link';
import SearchWidget from './components/SearchWidget';

// The homepage is a static server component — real prose that prerenders (and therefore yields a
// faithful markdown twin) — with the interactive search as its one client island.
export const metadata: Metadata = {
  title: 'Ora Air — one-way fares across four continents',
  description:
    'Book one-way flights across 12 destinations on four continents. Flexible fares, ' +
    'award-winning cabins, and Ora Miles rewards — search, pick a seat, and pay in minutes.',
};

const DESTINATIONS = [
  { city: 'London', code: 'LHR', price: 389, gradient: 'from-[#2c3e6b] to-[#0c1f3f]' },
  { city: 'Tokyo', code: 'NRT', price: 720, gradient: 'from-[#6b3e2c] to-[#3f200c]' },
  { city: 'Paris', code: 'CDG', price: 412, gradient: 'from-[#3e2c6b] to-[#200c3f]' },
  { city: 'Dubai', code: 'DXB', price: 545, gradient: 'from-[#2c6b5e] to-[#0c3f34]' },
];

export default function HomePage() {
  return (
    <div>
      <div className="relative overflow-hidden bg-gradient-to-b from-navy via-navy-soft to-[#2a4a7f] pb-36">
        <div className="pointer-events-none absolute inset-0 opacity-20">
          <div className="absolute -top-20 -right-40 h-96 w-96 rounded-full bg-gold blur-[140px]" />
          <div className="absolute bottom-0 -left-20 h-80 w-80 rounded-full bg-white blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-10 text-center">
          <div className="text-[13px] font-medium tracking-[0.24em] text-gold-bright uppercase">
            Fly beyond expectations
          </div>
          <h1 className="mt-4 text-4xl font-semibold text-white md:text-[52px] md:leading-[1.1]">
            Where will the horizon
            <br />
            take you next?
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-white/65">
            Non-stop routes across four continents, award-winning cabins, and fares designed around
            the way you travel.
          </p>
        </div>
      </div>

      <div className="relative z-10 mx-auto -mt-28 max-w-6xl px-6">
        <SearchWidget />
      </div>

      <div className="mx-auto max-w-6xl px-6 pt-20">
        <div className="mb-1 text-[13px] font-medium tracking-[0.2em] text-gold uppercase">
          Featured fares
        </div>
        <div className="mb-8 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold text-ink">Popular destinations from $389</h2>
          <Link href="/destinations" className="text-[14px] font-medium text-navy hover:underline">
            View all destinations →
          </Link>
        </div>
        <div className="grid gap-5 md:grid-cols-4">
          {DESTINATIONS.map((dest) => (
            <div
              key={dest.code}
              className={`group cursor-pointer rounded-2xl bg-gradient-to-br ${dest.gradient} p-6 text-white transition-transform hover:-translate-y-1`}
            >
              <div className="text-[12px] tracking-[0.16em] text-white/60 uppercase">
                {dest.code}
              </div>
              <div className="mt-1 text-xl font-semibold">{dest.city}</div>
              <div className="mt-10 text-[12px] text-white/60">One way from</div>
              <div className="text-lg font-semibold text-gold-bright">${dest.price}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 pt-20 md:grid-cols-3">
        {[
          {
            title: 'Flexible by design',
            body: 'Change your travel dates up to two hours before departure on Flex fares, with no change fees.',
          },
          {
            title: 'Award-winning cabins',
            body: 'From our refreshed Economy to lie-flat Business suites, every seat is designed around rest.',
          },
          {
            title: 'Ora Miles',
            body: 'Earn miles on every fare and unlock lounge access, upgrades, and partner rewards.',
          },
        ].map((item) => (
          <div key={item.title} className="rounded-2xl border border-line bg-white p-7">
            <div className="mb-2.5 text-[16px] font-semibold text-ink">{item.title}</div>
            <div className="text-[14px] leading-relaxed text-mist">{item.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
