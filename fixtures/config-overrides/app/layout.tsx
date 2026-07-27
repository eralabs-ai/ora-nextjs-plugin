import type { ReactNode } from 'react';

export const metadata = {
  title: 'Config Overrides Fixture',
  description: 'A Next.js app that declares catalog entries and denylist/allowlist via ax.config.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
