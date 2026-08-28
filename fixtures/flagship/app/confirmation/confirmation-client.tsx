'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StepBar from '../components/StepBar';
import { formatDateLong, formatDuration, money } from '../components/format';
import { useBooking } from '../state/BookingContext';
import { getAirport } from '@/lib/data/airports';

export default function ConfirmationClient() {
  const router = useRouter();
  const { hydrated, flight, fareCode, seatId, seatFee, passenger, pnr, resetFlow } = useBooking();

  useEffect(() => {
    if (hydrated && (!pnr || !flight)) router.replace('/');
  }, [hydrated, pnr, flight, router]);

  if (!hydrated || !pnr || !flight) return null;

  const fare = flight.fares.find((f) => f.code === fareCode);
  const total = (fare?.price ?? 0) + seatFee;
  const originAirport = getAirport(flight.origin);
  const destinationAirport = getAirport(flight.destination);

  return (
    <div className="flex min-h-screen flex-col">
      <StepBar current={3} />

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pt-6 pb-6">
        <div className="fade-up rounded-2xl border border-line bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-2xl text-success">
            ✓
          </div>
          <div className="text-[24px] font-semibold text-ink">You&apos;re booked!</div>
          <div className="mt-1.5 text-[14px] text-mist">
            Thanks {passenger?.firstName}, your seat is confirmed. Save this page for your records.
          </div>
          <div className="mt-6 inline-block rounded-xl bg-navy px-8 py-4">
            <div className="text-[11px] tracking-[0.2em] text-white/60 uppercase">
              Booking reference
            </div>
            <div className="mt-1 text-[26px] font-semibold tracking-[0.24em] text-gold-bright">
              {pnr}
            </div>
          </div>
        </div>

        <div className="fade-up mt-6 overflow-hidden rounded-2xl border border-line bg-white">
          <div className="bg-navy px-7 py-4 text-white">
            <div className="text-[12px] tracking-[0.18em] text-white/60 uppercase">Itinerary</div>
            <div className="mt-0.5 text-[16px] font-semibold">
              {originAirport?.city} to {destinationAirport?.city}
            </div>
          </div>
          <div className="grid gap-6 px-7 py-6 md:grid-cols-[1fr_auto_1fr]">
            <div>
              <div className="text-[28px] font-semibold text-ink">{flight.departureTime}</div>
              <div className="text-[14px] font-medium text-ink">
                {flight.origin} · {originAirport?.name}
              </div>
              <div className="text-[13px] text-mist">{formatDateLong(flight.date)}</div>
            </div>
            <div className="flex flex-col items-center justify-center text-[12px] text-mist">
              <div>{formatDuration(flight.durationMinutes)}</div>
              <div className="my-1.5 h-px w-24 bg-line" />
              <div>
                {flight.flightNumber} · {flight.aircraft}
              </div>
            </div>
            <div className="md:text-right">
              <div className="text-[28px] font-semibold text-ink">{flight.arrivalTime}</div>
              <div className="text-[14px] font-medium text-ink">
                {flight.destination} · {destinationAirport?.name}
              </div>
              <div className="text-[13px] text-mist">{formatDateLong(flight.date)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-line px-7 py-5 md:grid-cols-4">
            {[
              ['Passenger', `${passenger?.firstName} ${passenger?.lastName}`],
              ['Fare', fare?.name ?? ''],
              ['Seat', seatId ?? ''],
              ['Total paid', money(total)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[11px] tracking-wide text-mist uppercase">{label}</div>
                <div className="mt-0.5 text-[14px] font-semibold text-ink">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center">
          <div
            className="inline-block cursor-pointer rounded-lg border border-line bg-white px-6 py-2.5 text-[13.5px] font-medium text-ink transition-colors select-none hover:border-navy"
            onClick={() => {
              resetFlow();
              router.push('/');
            }}
          >
            Book another trip
          </div>
        </div>
      </div>
    </div>
  );
}
