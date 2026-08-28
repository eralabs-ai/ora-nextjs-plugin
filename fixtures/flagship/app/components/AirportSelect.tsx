'use client';

import { useEffect, useRef, useState } from 'react';
import { AIRPORTS, type Airport } from '@/lib/data/airports';

interface Props {
  placeholder: string;
  value: string | null; // airport code
  onChange: (code: string) => void;
  exclude?: string | null;
}

export default function AirportSelect({ placeholder, value, onChange, exclude }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = value ? AIRPORTS.find((a) => a.code === value) : null;
  const query = filter.trim().toLowerCase();
  const options = AIRPORTS.filter(
    (a) =>
      a.code !== exclude &&
      (!query ||
        a.city.toLowerCase().includes(query) ||
        a.code.toLowerCase().includes(query) ||
        a.name.toLowerCase().includes(query)),
  );

  const pick = (airport: Airport) => {
    onChange(airport.code);
    setOpen(false);
    setFilter('');
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`cursor-pointer rounded-xl border bg-white px-4 py-3 transition-colors ${
          open ? 'border-navy' : 'border-line hover:border-mist'
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="text-[11px] font-medium tracking-wide text-mist uppercase">
          {placeholder}
        </div>
        {selected ? (
          <div className="mt-0.5 flex items-baseline gap-2">
            <div className="text-[15px] font-semibold text-ink">{selected.city}</div>
            <div className="text-[12px] text-mist">{selected.code}</div>
          </div>
        ) : (
          <div className="mt-0.5 text-[15px] text-[#9aa7ba]">Select city</div>
        )}
      </div>
      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-2 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <input
            autoFocus
            className="w-full border-b border-line px-4 py-3 text-[14px]"
            placeholder="Search city or airport"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto">
            {options.map((airport) => (
              <div
                key={airport.code}
                className="flex cursor-pointer items-center justify-between px-4 py-2.5 transition-colors hover:bg-cloud"
                onClick={() => pick(airport)}
              >
                <div>
                  <div className="text-[14px] font-medium text-ink">{airport.city}</div>
                  <div className="text-[12px] text-mist">{airport.name}</div>
                </div>
                <div className="rounded-md bg-cloud px-2 py-0.5 text-[12px] font-semibold text-navy">
                  {airport.code}
                </div>
              </div>
            ))}
            {options.length === 0 && (
              <div className="px-4 py-3 text-[13px] text-mist">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
