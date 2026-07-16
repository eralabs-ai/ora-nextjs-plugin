import type { ReactNode } from 'react';

export const metadata = {
  title: 'WebMCP Declarative Fixture',
  description: 'Declares an in-page WebMCP tool with JSX <form toolname="...">.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
