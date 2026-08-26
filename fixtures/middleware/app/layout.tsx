import type { ReactNode } from 'react';

export const metadata = {
  title: 'Middleware Fixture',
  description:
    'Exercises the @ora-ai/ax-nextjs/middleware negotiation entry against a real next build.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/">Home</a> <a href="/docs">Docs</a>
        </nav>
        {children}
        <footer>© Middleware Fixture</footer>
      </body>
    </html>
  );
}
