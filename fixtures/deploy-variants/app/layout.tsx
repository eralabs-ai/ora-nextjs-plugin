import type { ReactNode } from 'react';

export const metadata = {
  title: 'Deploy Variants Fixture',
  description:
    'basePath and output: standalone — deployment settings that affect catalog emission.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
