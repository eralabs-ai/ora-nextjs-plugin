import { NextResponse } from 'next/server';
import { createBooking } from '@/lib/services/booking';
import { guard, badRequest, backendDelay } from '@/lib/services/api-guard';

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  let body: { f?: string; c?: string; s?: string; px?: { fn?: string; ln?: string; em?: string } };
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (!body.f || !body.c || !body.s || !body.px) return badRequest();

  await backendDelay();

  const result = createBooking({
    flightId: body.f,
    fareClass: body.c,
    seatId: body.s,
    passenger: {
      firstName: body.px.fn ?? '',
      lastName: body.px.ln ?? '',
      email: body.px.em ?? '',
    },
  });
  if ('error' in result) return badRequest();

  return NextResponse.json(
    { b: result.bookingId, a: result.amount },
    { headers: { 'cache-control': 'no-store' } },
  );
}
