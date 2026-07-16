import type { ReactNode } from 'react';

export const metadata = {
  title: 'Monorepo Web Fixture',
  description: 'A Next.js app nested at apps/web inside a Turborepo.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
