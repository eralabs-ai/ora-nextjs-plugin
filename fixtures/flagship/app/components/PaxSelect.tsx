'use client';

interface Props {
  value: number;
  onChange: (count: number) => void;
}

export default function PaxSelect({ value, onChange }: Props) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-mist uppercase">Passengers</div>
      <div className="mt-0.5 flex items-center justify-between">
        <div className="text-[15px] font-semibold text-ink">
          {value} {value === 1 ? 'Adult' : 'Adults'}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border text-[14px] select-none ${
              value <= 1
                ? 'border-line text-line'
                : 'border-mist text-mist hover:border-navy hover:text-navy'
            }`}
            onClick={() => value > 1 && onChange(value - 1)}
          >
            −
          </div>
          <div
            className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border text-[14px] select-none ${
              value >= 6
                ? 'border-line text-line'
                : 'border-mist text-mist hover:border-navy hover:text-navy'
            }`}
            onClick={() => value < 6 && onChange(value + 1)}
          >
            +
          </div>
        </div>
      </div>
    </div>
  );
}
