'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  verified: boolean;
  onVerified: () => void;
}

// "Slide to verify" gate. Requires a real pointer drag; a plain click does nothing.
export default function SliderCaptcha({ verified, onVerified }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const progressRef = useRef(0);
  const [progress, setProgress] = useState(0);

  const updateFromPointer = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const usable = rect.width - 44;
    const next = Math.min(1, Math.max(0, (clientX - rect.left - 22) / usable));
    progressRef.current = next;
    setProgress(next);
  }, []);

  useEffect(() => {
    if (verified) return;
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current) updateFromPointer(e.clientX);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (progressRef.current >= 0.92) {
        setProgress(1);
        onVerified();
      } else {
        progressRef.current = 0;
        setProgress(0);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [verified, onVerified, updateFromPointer]);

  const pct = verified ? 1 : progress;

  return (
    <div
      ref={trackRef}
      className={`relative h-11 overflow-hidden rounded-full select-none ${
        verified ? 'bg-success/10' : 'bg-cloud'
      } border ${verified ? 'border-success/40' : 'border-line'}`}
    >
      <div
        className={`absolute inset-y-0 left-0 ${verified ? 'bg-success/15' : 'bg-navy/8'}`}
        style={{ width: `${pct * 100}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center text-[13px] text-mist">
        {verified ? (
          <span className="font-medium text-success">Verified — you&apos;re human</span>
        ) : (
          "Slide to verify you're not a robot"
        )}
      </div>
      {!verified && (
        <div
          className="absolute top-1 flex h-9 w-9 cursor-grab touch-none items-center justify-center rounded-full bg-navy text-white shadow-md active:cursor-grabbing"
          style={{ left: `calc((100% - 44px) * ${pct} + 4px)` }}
          onPointerDown={(e) => {
            draggingRef.current = true;
            updateFromPointer(e.clientX);
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
        >
          →
        </div>
      )}
    </div>
  );
}
