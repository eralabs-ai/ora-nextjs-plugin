import type { MetadataRoute } from 'next';

// The idiomatic Next.js way to emit sitemap.xml. ax detects this file and recommends
// referencing it from robots.txt — it never generates a sitemap itself.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://discovery-fixture.example.com',
      lastModified: '2026-01-01T00:00:00.000Z',
    },
  ];
}
