'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface FareView {
  code: string;
  name: string;
  price: number;
  perks: string[];
}

export interface FlightView {
  id: string;
  flightNumber: string;
  origin: string;
  destination: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  aircraft: string;
  fares: FareView[];
}

export interface SearchState {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  passengers: number;
}

export interface PassengerState {
  firstName: string;
  lastName: string;
  email: string;
}

interface FlowState {
  search: SearchState | null;
  flight: FlightView | null;
  fareCode: string | null;
  seatId: string | null;
  seatFee: number;
  holdExpiresAt: number | null;
  passenger: PassengerState | null;
  pnr: string | null;
}

const EMPTY_FLOW: FlowState = {
  search: null,
  flight: null,
  fareCode: null,
  seatId: null,
  seatFee: 0,
  holdExpiresAt: null,
  passenger: null,
  pnr: null,
};

interface BookingContextValue extends FlowState {
  hydrated: boolean;
  setSearch: (search: SearchState) => void;
  selectFlight: (flight: FlightView, fareCode: string) => void;
  selectSeat: (seatId: string, seatFee: number) => void;
  startHold: () => void;
  completeBooking: (pnr: string, passenger: PassengerState) => void;
  resetFlow: () => void;
  api: <T>(path: string, body: unknown) => Promise<T>;
}

const BookingContext = createContext<BookingContextValue | null>(null);

const STORAGE_KEY = 'mr.flow';

export function BookingProvider({ children }: { children: ReactNode }) {
  const [flow, setFlow] = useState<FlowState>(EMPTY_FLOW);
  const [hydrated, setHydrated] = useState(false);
  const tokenRef = useRef<string | null>(null);

  // Flow state lives only in this tab's sessionStorage. Nothing is in the URL.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setFlow({ ...EMPTY_FLOW, ...JSON.parse(raw) });
    } catch {
      // ignore corrupt state
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flow));
  }, [flow, hydrated]);

  const api = useCallback(async <T,>(path: string, body: unknown): Promise<T> => {
    if (!tokenRef.current) {
      const res = await fetch('/api/session', { method: 'POST' });
      tokenRef.current = (await res.json()).t;
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mt': tokenRef.current! },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('request_failed');
    return res.json();
  }, []);

  const setSearch = useCallback((search: SearchState) => {
    setFlow({ ...EMPTY_FLOW, search });
  }, []);

  const selectFlight = useCallback((flight: FlightView, fareCode: string) => {
    setFlow((prev) => ({
      ...prev,
      flight,
      fareCode,
      seatId: null,
      seatFee: 0,
      passenger: null,
      pnr: null,
    }));
  }, []);

  const selectSeat = useCallback((seatId: string, seatFee: number) => {
    setFlow((prev) => ({ ...prev, seatId, seatFee }));
  }, []);

  const startHold = useCallback(() => {
    setFlow((prev) =>
      prev.holdExpiresAt ? prev : { ...prev, holdExpiresAt: Date.now() + 10 * 60 * 1000 },
    );
  }, []);

  const completeBooking = useCallback((pnr: string, passenger: PassengerState) => {
    setFlow((prev) => ({ ...prev, pnr, passenger, holdExpiresAt: null }));
  }, []);

  const resetFlow = useCallback(() => {
    setFlow(EMPTY_FLOW);
  }, []);

  return (
    <BookingContext.Provider
      value={{
        ...flow,
        hydrated,
        setSearch,
        selectFlight,
        selectSeat,
        startHold,
        completeBooking,
        resetFlow,
        api,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
}

// NOTE: children render unconditionally — a hydration gate here would replace every page's
// server-rendered HTML with a splash screen site-wide (agents and crawlers would see nothing).
// The booking-flow pages that actually depend on restored sessionStorage state each guard on
// `hydrated` themselves; static pages stay fully server-rendered.
function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy">
      <div className="flex flex-col items-center gap-4">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <path
            d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
            fill="#c9a227"
          />
        </svg>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/50"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function useBooking(): BookingContextValue {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error('useBooking outside provider');
  return ctx;
}
