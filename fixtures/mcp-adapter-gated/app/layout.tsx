import type { ReactNode } from 'react';

export const metadata = {
  title: 'MCP Adapter (gated) Fixture',
  description: 'A Next.js app hosting an MCP server gated behind OAuth via withMcpAuth.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
