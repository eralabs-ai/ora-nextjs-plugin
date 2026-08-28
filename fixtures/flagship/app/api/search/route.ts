import { NextResponse } from 'next/server';
import { searchFlights } from '@/lib/services/search';
import { badRequest, backendDelay } from '@/lib/services/api-guard';

/**
 * Public flight search. Read-only, unauthenticated endpoint for third-party clients.
 *
 * Query parameters:
 *   origin       IATA airport code (required), e.g. "JFK"
 *   destination  IATA airport code (required), e.g. "LAX"
 *   date         Departure date, YYYY-MM-DD (required)
 *   passengers   Passenger count 1-9 (optional, default 1)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.searchParams.get('origin');
  const destination = url.searchParams.get('destination');
  const date = url.searchParams.get('date');
  const passengersRaw = url.searchParams.get('passengers');

  if (!origin || !destination || !date) {
    return NextResponse.json(
      { error: 'origin, destination and date are required query parameters' },
      { status: 400 },
    );
  }

  const passengers = passengersRaw ? Number(passengersRaw) : 1;
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 9) {
    return NextResponse.json(
      { error: 'passengers must be an integer between 1 and 9' },
      { status: 400 },
    );
  }

  const flights = searchFlights({ origin, destination, date, passengers });
  if (!flights) {
    return NextResponse.json(
      { error: 'unknown airport code or invalid date (expected YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  return NextResponse.json({ flights }, { headers: { 'cache-control': 'no-store' } });
}

// Internal endpoint backing the web UI: minified payloads, paired with the browser-minted token
// flow. Not part of the public API — third-party clients use the GET handler above.
export async function POST(request: Request) {
  let body: { o?: string; d?: string; dt?: string; px?: number };
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (!body.o || !body.d || !body.dt) return badRequest();

  await backendDelay();

  const flights = searchFlights({
    origin: body.o,
    destination: body.d,
    date: body.dt,
    passengers: body.px ?? 1,
  });
  if (!flights) return badRequest();

  return NextResponse.json(
    {
      r: flights.map((f) => ({
        i: f.id,
        fn: f.flightNumber,
        o: f.origin,
        d: f.destination,
        dp: f.departureTime,
        ar: f.arrivalTime,
        du: f.durationMinutes,
        ac: f.aircraft,
        fr: f.fares.map((fare) => ({
          c: fare.classCode,
          n: fare.className,
          a: fare.price,
          pk: fare.perks,
        })),
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
