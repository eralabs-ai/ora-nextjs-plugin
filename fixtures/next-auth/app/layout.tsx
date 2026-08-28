import type { ReactNode } from 'react';

export const metadata = {
  title: 'next-auth Fixture',
  description: 'A minimal app with next-auth wired, for auth-provider detection.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
