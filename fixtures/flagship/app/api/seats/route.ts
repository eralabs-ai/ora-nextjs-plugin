import { NextResponse } from 'next/server';
import { getSeatMap } from '@/lib/data/seatmaps';
import { guard, badRequest, backendDelay } from '@/lib/services/api-guard';

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  let body: { f?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (!body.f) return badRequest();

  await backendDelay();

  const seatMap = getSeatMap(body.f);
  if (!seatMap) return badRequest();

  return NextResponse.json(
    {
      ac: seatMap.aircraft,
      cb: seatMap.cabins.map((cabin) => ({
        n: cabin.name,
        fc: cabin.fareClasses,
        cl: cabin.columns,
        rw: cabin.rows,
        st: cabin.seats.map((s) => ({
          s: s.id,
          r: s.row,
          c: s.column,
          o: s.occupied ? 1 : 0,
          x: s.extraLegroom ? 1 : 0,
          p: s.fee,
        })),
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
