import { NextResponse } from 'next/server';

// RFC 8414 authorization-server metadata served from this origin, for MCP clients that look for
// the sign-in flow on the resource server's own domain. Static and deterministic: the endpoints
// point at routes that don't exist because no fixture test ever drives a real OAuth handshake —
// what matters is that the discovery chain (401 → RFC 9728 → this document) is fully walkable.
const SITE_URL = 'https://flagship-fixture.example.com';

const metadata = {
  issuer: SITE_URL,
  authorization_endpoint: `${SITE_URL}/oauth/authorize`,
  token_endpoint: `${SITE_URL}/oauth/token`,
  registration_endpoint: `${SITE_URL}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
  scopes_supported: ['email', 'profile'],
};

export function GET(): NextResponse {
  return NextResponse.json(metadata, {
    headers: { 'access-control-allow-origin': '*' },
  });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': '*',
    },
  });
}
