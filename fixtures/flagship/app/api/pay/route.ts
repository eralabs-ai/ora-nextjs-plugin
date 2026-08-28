import { NextResponse } from 'next/server';
import { getBooking, confirmBooking } from '@/lib/services/booking';
import { chargeCard } from '@/lib/services/payment';
import { guard, badRequest, backendDelay } from '@/lib/services/api-guard';

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  let body: { b?: string; cn?: string; ex?: string; cv?: string; nm?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (!body.b || !body.cn || !body.ex || !body.cv) return badRequest();

  await backendDelay();

  const booking = getBooking(body.b);
  if (!booking || booking.status !== 'pending') return badRequest();

  const charge = chargeCard(
    { cardNumber: body.cn, expiry: body.ex, cvv: body.cv, holderName: body.nm ?? '' },
    booking.amount,
  );
  // Vague on purpose: no decline reason reaches the client.
  if (!charge.success) return NextResponse.json({ e: 'ERR' }, { status: 400 });

  const confirmed = confirmBooking(booking.bookingId, charge.paymentRef!);
  if ('error' in confirmed) return badRequest();

  return NextResponse.json(
    { p: confirmed.pnr, b: confirmed.bookingId },
    { headers: { 'cache-control': 'no-store' } },
  );
}
