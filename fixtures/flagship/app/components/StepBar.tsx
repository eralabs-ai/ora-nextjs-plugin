'use client';

const STEPS = ['Flights', 'Seats', 'Payment', 'Done'];

export default function StepBar({ current }: { current: number }) {
  return (
    <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 pt-8 pb-2">
      {STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                i < current
                  ? 'bg-success text-white'
                  : i === current
                    ? 'bg-navy text-white'
                    : 'bg-line text-mist'
              }`}
            >
              {i < current ? '✓' : i + 1}
            </div>
            <div
              className={`text-[13px] ${i === current ? 'font-semibold text-ink' : 'text-mist'}`}
            >
              {step}
            </div>
          </div>
          {i < STEPS.length - 1 && <div className="h-px w-8 bg-line md:w-14" />}
        </div>
      ))}
    </div>
  );
}
