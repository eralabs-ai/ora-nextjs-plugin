import type { ReactNode } from 'react';

export const metadata = {
  title: 'OpenAPI Fixture',
  description: 'An app that already serves an openapi.json for its REST API.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
