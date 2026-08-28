// Organization structured data, scaffolded by ax (scaffoldJsonLd). This file is yours: edit
// it freely, ax never overwrites it.
//
// Nothing renders it until you add it to your root layout — one import and one element:
//   import { OrganizationJsonLd } from './organization-json-ld';
//   ...then render <OrganizationJsonLd /> inside <body>.
//
// Worth adding beyond the fields below: a logo, an address, and at least one more schema.org
// @type for what you actually offer (SoftwareApplication / Product for an app or API, FAQPage for
// a support site) — covering more types helps registries understand the site more fully.
const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'ora-air',
  url: 'https://flagship-fixture.example.com',
  sameAs: [
    'https://flagship-fixture.example.com/',
    'https://flagship-fixture.example.com/.well-known/ai-catalog.json',
    'https://flagship-fixture.example.com/.well-known/mcp/server-card.json',
  ],
};

export function OrganizationJsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
    />
  );
}
