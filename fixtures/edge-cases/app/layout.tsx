import type { ReactNode } from 'react';

export const metadata = {
  title: 'Edge Cases Fixture',
  description: 'Ambiguous and adversarial patterns that must not produce false positives.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
