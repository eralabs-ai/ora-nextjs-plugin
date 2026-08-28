'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBooking } from '../state/BookingContext';

export default function FareHoldBanner() {
  const { holdExpiresAt, resetFlow } = useBooking();
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!holdExpiresAt) return;
    const tick = () => {
      const ms = holdExpiresAt - Date.now();
      if (ms <= 0) {
        resetFlow();
        router.replace('/');
        return;
      }
      setRemaining(ms);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [holdExpiresAt, resetFlow, router]);

  if (!holdExpiresAt || remaining === null) return null;

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  const urgent = totalSeconds < 120;

  return (
    <div
      className={`${urgent ? 'bg-danger' : 'bg-navy-soft'} py-2 text-center text-[13px] text-white transition-colors`}
    >
      We&apos;re holding your fare for{' '}
      <span className="font-semibold tabular-nums">
        {minutes}:{seconds}
      </span>{' '}
      — complete your booking before the hold expires.
    </div>
  );
}
