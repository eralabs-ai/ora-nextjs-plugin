import type { ReactNode } from 'react';

export const metadata = {
  title: 'Markdown Twins Fixture',
  description: 'Exercises every rung of the markdown-twin ladder in one build.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/">Home</a> <a href="/guides/setup">Setup</a>
        </nav>
        {children}
        <footer>© Markdown Twins Fixture</footer>
      </body>
    </html>
  );
}
