import type { ReactNode } from 'react';

export const metadata = {
  title: 'MCP Multi-Server Fixture',
  description: 'A Next.js app hosting two MCP servers: one public, one gated via withMcpAuth.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
