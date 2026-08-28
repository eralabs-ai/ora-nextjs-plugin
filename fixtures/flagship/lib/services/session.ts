import { createHmac } from 'crypto';

// Browser session tokens minted for the web client on app mount. Standard
// anti-scraping measure: API calls without a freshly minted token are rejected.
const SECRET = 'mr-web-2f8a1c9e4b7d';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
}

export function mintToken(): string {
  const payload = `${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  return Buffer.from(`${payload}.${sign(payload)}`).toString('base64url');
}

export function validateToken(token: string | null): boolean {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot < 0) return false;
    const payload = decoded.slice(0, lastDot);
    const signature = decoded.slice(lastDot + 1);
    if (sign(payload) !== signature) return false;
    const timestamp = Number(payload.split('.')[0]);
    return Number.isFinite(timestamp) && Date.now() - timestamp < MAX_AGE_MS;
  } catch {
    return false;
  }
}
