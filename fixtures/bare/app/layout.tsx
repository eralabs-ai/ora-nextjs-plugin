import type { ReactNode } from 'react';

export const metadata = {
  title: 'Bare Fixture',
  description: 'A fresh create-next-app with no config and no tools.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
