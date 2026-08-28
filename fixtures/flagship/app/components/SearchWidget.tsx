'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AirportSelect from './AirportSelect';
import DateSelect from './DateSelect';
import PaxSelect from './PaxSelect';
import { useBooking } from '../state/BookingContext';

// The one interactive island on the (otherwise static, server-rendered) homepage: route + date +
// passenger selection, handing off to /results via the booking context.
export default function SearchWidget() {
  const router = useRouter();
  const { setSearch } = useBooking();
  const [origin, setOrigin] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [passengers, setPassengers] = useState(1);
  const [error, setError] = useState(false);

  const submit = () => {
    if (!origin || !destination || !date) {
      setError(true);
      return;
    }
    setSearch({ origin, destination, date, passengers });
    router.push('/results');
  };

  return (
    <div className="rounded-2xl bg-white p-6 shadow-[0_20px_60px_rgba(12,31,63,0.18)]">
      <div className="mb-5 flex items-center gap-6 text-[14px]">
        <div className="cursor-pointer border-b-2 border-gold pb-1.5 font-semibold text-ink">
          One way
        </div>
        <div className="cursor-pointer pb-1.5 text-mist transition-colors hover:text-ink">
          Round trip
        </div>
        <div className="cursor-pointer pb-1.5 text-mist transition-colors hover:text-ink">
          Multi-city
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_0.8fr_auto]">
        <AirportSelect
          placeholder="From"
          value={origin}
          onChange={(code) => {
            setOrigin(code);
            setError(false);
          }}
          exclude={destination}
        />
        <AirportSelect
          placeholder="To"
          value={destination}
          onChange={(code) => {
            setDestination(code);
            setError(false);
          }}
          exclude={origin}
        />
        <DateSelect
          value={date}
          onChange={(d) => {
            setDate(d);
            setError(false);
          }}
        />
        <PaxSelect value={passengers} onChange={setPassengers} />
        <div
          className="flex cursor-pointer items-center justify-center rounded-xl bg-gold px-7 text-[15px] font-semibold text-navy-deep transition-colors select-none hover:bg-gold-bright max-md:py-3.5"
          onClick={submit}
        >
          Search flights
        </div>
      </div>
      {error && (
        <div className="mt-3 text-[13px] text-danger">
          Please choose your route and travel date to continue.
        </div>
      )}
    </div>
  );
}
