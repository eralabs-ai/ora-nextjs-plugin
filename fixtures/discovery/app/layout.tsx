import type { ReactNode } from 'react';

export const metadata = {
  title: 'Discovery Fixture',
  description: 'An app that already ships robots.txt, a sitemap, and agents.md.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
