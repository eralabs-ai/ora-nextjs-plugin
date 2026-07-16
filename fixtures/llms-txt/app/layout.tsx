import type { ReactNode } from 'react';

export const metadata = {
  title: 'llms.txt Fixture',
  description: 'An app that already serves an llms.txt agent-docs index.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
