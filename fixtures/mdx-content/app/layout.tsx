import type { ReactNode } from 'react';

export const metadata = {
  title: 'MDX Content Fixture',
  description: 'Exercises Tier-1 markdown-twin derivation from page.mdx sources.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
