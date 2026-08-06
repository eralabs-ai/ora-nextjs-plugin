import type { ReactNode } from 'react';

export const metadata = {
  title: 'Hybrid Fixture',
  description: 'A Next.js app with both an App Router and a Pages Router.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
