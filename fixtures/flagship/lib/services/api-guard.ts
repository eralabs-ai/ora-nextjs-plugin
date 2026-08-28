import { NextResponse } from 'next/server';
import { validateToken } from './session';

// Guards the internal write endpoints (seats/book/pay) used by the web UI. They require the x-mt
// token minted by the browser client and are not part of the public API. The public read endpoint
// (GET /api/search) is intentionally unauthenticated.
export function guard(request: Request): NextResponse | null {
  if (!validateToken(request.headers.get('x-mt'))) {
    return NextResponse.json({ e: 'ERR_AUTH' }, { status: 401 });
  }
  return null;
}

export function badRequest(): NextResponse {
  return NextResponse.json({ e: 'ERR' }, { status: 400 });
}

// Simulated backend latency so the UI skeleton states feel real.
export function backendDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 400));
}
