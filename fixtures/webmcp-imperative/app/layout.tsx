import type { ReactNode } from 'react';

export const metadata = {
  title: 'WebMCP Imperative Fixture',
  description: 'Registers an in-page WebMCP tool via navigator.modelContext.registerTool().',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
