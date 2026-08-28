import type { MetadataRoute } from 'next';

const siteUrl = 'https://flagship-fixture.example.com';

// Fixed lastModified keeps the emitted sitemap.xml identical everywhere the fixture is built.
const lastModified = new Date('2026-01-01T00:00:00.000Z');

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${siteUrl}/`, lastModified, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/destinations`, lastModified, changeFrequency: 'daily', priority: 0.9 },
    { url: `${siteUrl}/guide`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/results`, lastModified, changeFrequency: 'daily', priority: 0.8 },
    { url: `${siteUrl}/seats`, lastModified, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${siteUrl}/checkout`, lastModified, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${siteUrl}/confirmation`, lastModified, changeFrequency: 'weekly', priority: 0.6 },
  ];
}
