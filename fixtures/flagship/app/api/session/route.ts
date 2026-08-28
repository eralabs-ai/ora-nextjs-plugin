import { NextResponse } from 'next/server';
import { mintToken } from '@/lib/services/session';

export async function POST() {
  return NextResponse.json({ t: mintToken() }, { headers: { 'cache-control': 'no-store' } });
}
