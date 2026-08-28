'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import StepBar from '../components/StepBar';
import { formatDateLong, formatDuration, money } from '../components/format';
import { useBooking, type FlightView } from '../state/BookingContext';
import { getAirport } from '@/lib/data/airports';

interface ApiFlight {
  i: string;
  fn: string;
  o: string;
  d: string;
  dp: string;
  ar: string;
  du: number;
  ac: string;
  fr: { c: string; n: string; a: number; pk: string[] }[];
}

const FARE_ORDER = ['Y1', 'Y2', 'J1'];

export default function ResultsClient() {
  const router = useRouter();
  const { hydrated, search, selectFlight, api } = useBooking();
  const [flights, setFlights] = useState<FlightView[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!search) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    api<{ r: ApiFlight[] }>('/api/search', {
      o: search.origin,
      d: search.destination,
      dt: search.date,
      px: search.passengers,
    })
      .then((data) => {
        if (cancelled) return;
        setFlights(
          data.r.map((f) => ({
            id: f.i,
            flightNumber: f.fn,
            origin: f.o,
            destination: f.d,
            date: search.date,
            departureTime: f.dp,
            arrivalTime: f.ar,
            durationMinutes: f.du,
            aircraft: f.ac,
            fares: f.fr.map((fare) => ({
              code: fare.c,
              name: fare.n,
              price: fare.a,
              perks: fare.pk,
            })),
          })),
        );
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [hydrated, search, api, router]);

  if (!hydrated || !search) return null;

  const originAirport = getAirport(search.origin);
  const destinationAirport = getAirport(search.destination);

  const pick = (flight: FlightView, fareCode: string) => {
    selectFlight(flight, fareCode);
    router.push('/seats');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <StepBar current={0} />

      <div className="mx-auto w-full max-w-6xl flex-1 px-6 pt-4">
        <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="text-[22px] font-semibold text-ink">
            {originAirport?.city} → {destinationAirport?.city}
          </div>
          <div className="text-[14px] text-mist">
            {formatDateLong(search.date)} · {search.passengers}{' '}
            {search.passengers === 1 ? 'adult' : 'adults'} · One way
          </div>
        </div>

        {failed && (
          <div className="rounded-xl border border-danger/30 bg-danger/5 px-5 py-4 text-[14px] text-danger">
            Something went wrong loading flights. Please try again.
          </div>
        )}

        {!flights && !failed && (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-[92px] w-full" />
            ))}
          </div>
        )}

        {flights && (
          <div className="space-y-3 pb-4">
            {flights.map((flight) => {
              const cheapest = Math.min(...flight.fares.map((f) => f.price));
              const expanded = expandedId === flight.id;
              return (
                <div
                  key={flight.id}
                  className="fade-up overflow-hidden rounded-xl border border-line bg-white transition-shadow hover:shadow-md"
                >
                  <div
                    className="grid cursor-pointer items-center gap-4 px-6 py-5 md:grid-cols-[110px_1fr_120px_150px]"
                    onClick={() => setExpandedId(expanded ? null : flight.id)}
                  >
                    <div>
                      <div className="text-[12px] text-mist">{flight.flightNumber}</div>
                      <div className="text-[12px] text-mist">{flight.aircraft}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-[20px] font-semibold text-ink">
                          {flight.departureTime}
                        </div>
                        <div className="text-[12px] text-mist">{flight.origin}</div>
                      </div>
                      <div className="flex flex-1 flex-col items-center px-2">
                        <div className="text-[11px] text-mist">
                          {formatDuration(flight.durationMinutes)}
                        </div>
                        <div className="relative my-1 h-px w-full bg-line">
                          <div className="absolute top-1/2 right-0 h-1.5 w-1.5 -translate-y-1/2 rotate-45 border-t border-r border-mist" />
                        </div>
                        <div className="text-[11px] text-mist">Non-stop</div>
                      </div>
                      <div>
                        <div className="text-[20px] font-semibold text-ink">
                          {flight.arrivalTime}
                        </div>
                        <div className="text-[12px] text-mist">{flight.destination}</div>
                      </div>
                    </div>
                    <div className="max-md:hidden" />
                    <div className="text-right">
                      <div className="text-[12px] text-mist">from</div>
                      <div className="text-[20px] font-semibold text-navy">{money(cheapest)}</div>
                      <div className="text-[12px] font-medium text-gold">
                        {expanded ? 'Hide fares' : 'View fares'}
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <div className="grid gap-3 border-t border-line bg-cloud/60 px-6 py-5 md:grid-cols-3">
                      {FARE_ORDER.map((code) => {
                        const fare = flight.fares.find((f) => f.code === code);
                        if (!fare) return null;
                        const business = code === 'J1';
                        return (
                          <div
                            key={code}
                            className={`rounded-xl border bg-white p-5 ${
                              business ? 'border-gold/50' : 'border-line'
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <div className="text-[14px] font-semibold text-ink">{fare.name}</div>
                              {business && (
                                <div className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-gold uppercase">
                                  Premium
                                </div>
                              )}
                            </div>
                            <div className="mb-3 text-[20px] font-semibold text-navy">
                              {money(fare.price)}
                            </div>
                            <div className="mb-4 space-y-1.5">
                              {fare.perks.map((perk) => (
                                <div
                                  key={perk}
                                  className="flex items-start gap-1.5 text-[12.5px] text-mist"
                                >
                                  <span className="mt-px text-success">✓</span>
                                  {perk}
                                </div>
                              ))}
                            </div>
                            <div
                              className={`cursor-pointer rounded-lg py-2.5 text-center text-[13.5px] font-semibold transition-colors select-none ${
                                business
                                  ? 'bg-navy text-white hover:bg-navy-soft'
                                  : 'bg-gold text-navy-deep hover:bg-gold-bright'
                              }`}
                              onClick={() => pick(flight, code)}
                            >
                              Select
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
