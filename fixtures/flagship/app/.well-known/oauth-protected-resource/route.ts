import { NextResponse } from 'next/server';

// RFC 9728 protected-resource metadata for the gated MCP server — the discovery document MCP
// clients fetch after a 401 to learn which authorization server to talk to. A real app would
// derive this from its identity provider; the fixture serves a static, deterministic document
// naming this origin's own stub authorization-server metadata.
const SITE_URL = 'https://flagship-fixture.example.com';

const metadata = {
  resource: `${SITE_URL}/api/mcp`,
  authorization_servers: [SITE_URL],
  bearer_methods_supported: ['header'],
  scopes_supported: ['email', 'profile'],
  resource_documentation: `${SITE_URL}/agents.md`,
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
