import type { ReactNode } from 'react';

export const metadata = {
  title: 'Discovery Fixture',
  description: 'An app that already ships robots.txt, a sitemap, and agents.md.',
};

// An Organization JSON-LD block with a `sameAs` array — the structured-data shape Ora scores
// (json-ld / org-schema-completeness / json-ld-entity-linking). ax only detects-and-
// recommends this; the content here is authored by the app, never guessed by the plugin.
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Discovery Fixture',
  url: 'https://discovery-fixture.example.com',
  sameAs: ['https://github.com/eralabs-ai', 'https://www.linkedin.com/company/example'],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
