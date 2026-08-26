import type { ReactNode } from 'react';

export const metadata = {
  title: 'Agent Skills Fixture',
  description:
    'A Next.js app that publishes agent skills alongside its docs and skills-repo pointer.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
