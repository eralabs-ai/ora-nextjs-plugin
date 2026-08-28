'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDateLong } from './format';

interface Props {
  value: string | null; // YYYY-MM-DD
  onChange: (date: string) => void;
}

function nextDays(count: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    days.push(
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
        .getDate()
        .toString()
        .padStart(2, '0')}`,
    );
  }
  return days;
}

export default function DateSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`cursor-pointer rounded-xl border bg-white px-4 py-3 transition-colors ${
          open ? 'border-navy' : 'border-line hover:border-mist'
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="text-[11px] font-medium tracking-wide text-mist uppercase">Departure</div>
        <div
          className={`mt-0.5 text-[15px] ${value ? 'font-semibold text-ink' : 'text-[#9aa7ba]'}`}
        >
          {value ? formatDateLong(value) : 'Select date'}
        </div>
      </div>
      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-white shadow-xl">
          {nextDays(30).map((date) => (
            <div
              key={date}
              className={`cursor-pointer px-4 py-2.5 text-[14px] transition-colors hover:bg-cloud ${
                date === value ? 'font-semibold text-navy' : 'text-ink'
              }`}
              onClick={() => {
                onChange(date);
                setOpen(false);
              }}
            >
              {formatDateLong(date)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
