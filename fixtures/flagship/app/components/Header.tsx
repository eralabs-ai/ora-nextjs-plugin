'use client';

import { useRouter } from 'next/navigation';

const NAV_ITEMS = ['Book', 'Manage trip', 'Check-in', 'Flight status', 'Help'];

export default function Header() {
  const router = useRouter();

  return (
    <div className="bg-navy text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div
          className="flex cursor-pointer items-center gap-2.5 select-none"
          onClick={() => router.push('/')}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
              fill="#c9a227"
            />
          </svg>
          <div className="text-lg font-semibold tracking-[0.18em]">ORA AIR</div>
        </div>
        <div className="hidden items-center gap-7 text-[13.5px] text-white/75 md:flex">
          {NAV_ITEMS.map((item) => (
            <div key={item} className="cursor-pointer transition-colors hover:text-white">
              {item}
            </div>
          ))}
          <div className="cursor-pointer rounded-full border border-white/25 px-4 py-1.5 text-white transition-colors hover:border-gold hover:text-gold-bright">
            Sign in
          </div>
        </div>
      </div>
    </div>
  );
}
