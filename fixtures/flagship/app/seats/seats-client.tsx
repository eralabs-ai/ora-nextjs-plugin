'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import StepBar from '../components/StepBar';
import FareHoldBanner from '../components/FareHoldBanner';
import { money } from '../components/format';
import { useBooking } from '../state/BookingContext';

interface ApiSeat {
  s: string;
  r: number;
  c: string;
  o: number;
  x: number;
  p: number;
}

interface ApiCabin {
  n: string;
  fc: string[];
  cl: string[];
  rw: number[];
  st: ApiSeat[];
}

export default function SeatsClient() {
  const router = useRouter();
  const { hydrated, flight, fareCode, seatId, seatFee, selectSeat, startHold, api } = useBooking();
  const [cabin, setCabin] = useState<ApiCabin | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!flight || !fareCode) {
      router.replace('/');
      return;
    }
    startHold();
    let cancelled = false;
    api<{ ac: string; cb: ApiCabin[] }>('/api/seats', { f: flight.id })
      .then((data) => {
        if (cancelled) return;
        setCabin(data.cb.find((c) => c.fc.includes(fareCode)) ?? null);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [hydrated, flight, fareCode, api, router, startHold]);

  if (!hydrated || !flight || !fareCode) return null;

  const fare = flight.fares.find((f) => f.code === fareCode);
  const seatByPosition = new Map(cabin?.st.map((s) => [s.s, s]) ?? []);

  const seatColor = (seat: ApiSeat, selected: boolean): string => {
    if (selected) return 'bg-gold border-gold text-navy-deep';
    if (seat.o) return 'bg-[#d4dae3] border-[#d4dae3] cursor-default';
    if (seat.x) return 'bg-[#dff0ec] border-[#9fd0c5] cursor-pointer hover:border-navy';
    return 'bg-white border-[#b9c3d0] cursor-pointer hover:border-navy';
  };

  return (
    <div className="flex min-h-screen flex-col">
      <FareHoldBanner />
      <StepBar current={1} />

      <div className="mx-auto w-full max-w-6xl flex-1 px-6 pt-4 pb-6">
        <div className="mb-6">
          <div className="text-[22px] font-semibold text-ink">Choose your seat</div>
          <div className="text-[14px] text-mist">
            {flight.flightNumber} · {flight.origin} → {flight.destination} · {fare?.name} ·{' '}
            {cabin?.n ?? ''} cabin
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
            {failed && (
              <div className="text-[14px] text-danger">
                Something went wrong loading the seat map. Please try again.
              </div>
            )}
            {!cabin && !failed && <div className="skeleton h-[420px] w-full" />}
            {cabin && (
              <div className="overflow-x-auto">
                <div className="mb-6 flex flex-wrap items-center gap-5 text-[12px] text-mist">
                  {[
                    ['bg-white border border-[#b9c3d0]', 'Available'],
                    ['bg-[#dff0ec] border border-[#9fd0c5]', 'Extra legroom'],
                    ['bg-[#d4dae3]', 'Unavailable'],
                    ['bg-gold', 'Selected'],
                  ].map(([cls, label]) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className={`h-3.5 w-3.5 rounded ${cls}`} />
                      {label}
                    </div>
                  ))}
                </div>

                <div className="mx-auto w-fit rounded-[40px] border-2 border-line px-6 py-10 md:px-10">
                  <div
                    className="mb-3 grid justify-items-center gap-1.5"
                    style={{ gridTemplateColumns: `28px repeat(${cabin.cl.length}, 34px)` }}
                  >
                    <div />
                    {cabin.cl.map((col, i) =>
                      col ? (
                        <div key={`${col}${i}`} className="text-[11px] font-medium text-mist">
                          {col}
                        </div>
                      ) : (
                        <div key={`gap-${i}`} />
                      ),
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {cabin.rw.map((row) => (
                      <div
                        key={row}
                        className="grid items-center justify-items-center gap-1.5"
                        style={{ gridTemplateColumns: `28px repeat(${cabin.cl.length}, 34px)` }}
                      >
                        <div className="text-[11px] text-mist">{row}</div>
                        {cabin.cl.map((col, i) => {
                          if (!col) return <div key={`gap-${i}`} />;
                          const seat = seatByPosition.get(`${row}${col}`);
                          if (!seat) return <div key={`${row}${col}`} />;
                          const selected = seatId === seat.s;
                          return (
                            <div
                              key={seat.s}
                              className={`h-8 w-8 rounded-t-lg rounded-b-sm border transition-colors ${seatColor(seat, selected)}`}
                              onClick={() => {
                                if (seat.o) return;
                                selectSeat(selected ? '' : seat.s, selected ? 0 : seat.p);
                              }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="h-fit rounded-2xl border border-line bg-white p-6">
            <div className="mb-4 text-[15px] font-semibold text-ink">Your selection</div>
            <div className="space-y-2.5 text-[13.5px]">
              <div className="flex justify-between">
                <div className="text-mist">Flight</div>
                <div className="font-medium text-ink">{flight.flightNumber}</div>
              </div>
              <div className="flex justify-between">
                <div className="text-mist">Fare</div>
                <div className="font-medium text-ink">{fare?.name}</div>
              </div>
              <div className="flex justify-between">
                <div className="text-mist">Seat</div>
                <div className="font-medium text-ink">{seatId || '—'}</div>
              </div>
              <div className="flex justify-between">
                <div className="text-mist">Seat fee</div>
                <div className="font-medium text-ink">{seatFee ? money(seatFee) : 'Included'}</div>
              </div>
              <div className="my-3 h-px bg-line" />
              <div className="flex justify-between text-[15px]">
                <div className="font-semibold text-ink">Total</div>
                <div className="font-semibold text-navy">{money((fare?.price ?? 0) + seatFee)}</div>
              </div>
            </div>
            <div
              className={`mt-6 rounded-lg py-3 text-center text-[14px] font-semibold transition-colors select-none ${
                seatId
                  ? 'cursor-pointer bg-gold text-navy-deep hover:bg-gold-bright'
                  : 'cursor-default bg-line text-mist'
              }`}
              onClick={() => seatId && router.push('/checkout')}
            >
              Continue to payment
            </div>
            <div
              className="mt-3 cursor-pointer text-center text-[13px] text-mist transition-colors hover:text-ink"
              onClick={() => router.push('/results')}
            >
              Back to flights
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
